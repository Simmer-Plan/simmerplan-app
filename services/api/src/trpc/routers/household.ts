// Copyright 2026 Dave LeBlanc
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Household router (SIM-29): household.create, invite, join, get. Behind the
// Lambda authorizer — userId/householdId come from ctx, never the request body.

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { BatchGetCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import type {
  HouseholdCreateResponse,
  HouseholdGetResponse,
  HouseholdInviteResponse,
  HouseholdJoinResponse,
  HouseholdRecord,
  InviteRecord,
  UserRecord,
} from '@simmerplan/types';
import { docClient, TABLE_NAME } from '../../lib/dynamo';
import { refreshTokens, setHouseholdClaim } from '../../lib/cognito';
import { getSecret } from '../../lib/secrets';
import { protectedProcedure, router } from '../trpc';

const INVITE_TTL_HOURS = 48;
const INVITE_SECRET = 'invite-signing-key';

interface InviteClaims {
  tokenId: string;
  householdId: string;
  invitedBy: string;
}

function inviteUrl(token: string): string {
  // Universal Link in production; custom scheme for Expo Go in sandbox.
  return process.env.ENVIRONMENT === 'prod'
    ? `https://simmerplan.com/join?token=${token}`
    : `simmerplan://join?token=${token}`;
}

async function maybeRefreshedTokens(refreshToken: string | undefined) {
  if (!refreshToken) return null;
  // The refreshed ID token carries the new custom:householdId claim.
  return refreshTokens(refreshToken).catch(() => {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid refresh token' });
  });
}

async function getUser(userId: string): Promise<UserRecord> {
  const result = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: `USER#${userId}`, SK: 'METADATA' } }),
  );
  if (!result.Item) throw new TRPCError({ code: 'NOT_FOUND', message: 'User record not found' });
  return result.Item as UserRecord;
}

export const householdRouter = router({
  // POST /household/create — new user only (householdId must be absent).
  create: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1), refreshToken: z.string().optional() }))
    .mutation(async ({ ctx, input }): Promise<HouseholdCreateResponse> => {
      if (ctx.householdId) {
        throw new TRPCError({ code: 'CONFLICT', message: 'User already belongs to a household' });
      }

      const householdId = randomUUID();
      const now = new Date().toISOString();
      const household: HouseholdRecord & { PK: string; SK: string } = {
        PK: `HOUSEHOLD#${householdId}`,
        SK: 'METADATA',
        householdId,
        name: input.name,
        createdBy: ctx.userId,
        memberIds: [ctx.userId],
        createdAt: now,
        updatedAt: now,
      };
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: household,
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );

      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: `USER#${ctx.userId}`, SK: 'METADATA' },
          UpdateExpression: 'SET householdId = :h, #role = :r, updatedAt = :now ADD version :one',
          ExpressionAttributeNames: { '#role': 'role' },
          ExpressionAttributeValues: { ':h': householdId, ':r': 'owner', ':now': now, ':one': 1 },
        }),
      );
      await setHouseholdClaim(ctx.userId, householdId);

      return {
        householdId,
        name: household.name,
        role: 'owner',
        tokens: await maybeRefreshedTokens(input.refreshToken),
      };
    }),

  // POST /household/invite — owner only.
  invite: protectedProcedure.mutation(async ({ ctx }): Promise<HouseholdInviteResponse> => {
    if (!ctx.householdId) throw new TRPCError({ code: 'FORBIDDEN', message: 'User has no household' });
    const user = await getUser(ctx.userId);
    if (user.role !== 'owner') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the household owner can invite' });
    }

    const tokenId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_HOURS * 3600 * 1000);
    const signingKey = await getSecret(INVITE_SECRET);
    const claims: InviteClaims = { tokenId, householdId: ctx.householdId, invitedBy: ctx.userId };
    const token = jwt.sign(claims, signingKey, {
      algorithm: 'HS256',
      expiresIn: `${INVITE_TTL_HOURS}h`,
    });

    const invite: InviteRecord & { PK: string; SK: string } = {
      PK: `INVITE#${tokenId}`,
      SK: 'METADATA',
      tokenId,
      householdId: ctx.householdId,
      invitedBy: ctx.userId,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      usedAt: null,
      usedBy: null,
      TTL: Math.floor(expiresAt.getTime() / 1000) + 7 * 24 * 3600,
    };
    await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: invite }));

    return { inviteUrl: inviteUrl(token), expiresAt: expiresAt.toISOString() };
  }),

  // POST /household/join — new user only; single-use invite via conditional write.
  join: protectedProcedure
    .input(z.object({ token: z.string().min(1), refreshToken: z.string().optional() }))
    .mutation(async ({ ctx, input }): Promise<HouseholdJoinResponse> => {
      if (ctx.householdId) {
        throw new TRPCError({ code: 'CONFLICT', message: 'User already belongs to a household' });
      }

      const signingKey = await getSecret(INVITE_SECRET);
      let claims: InviteClaims;
      try {
        claims = jwt.verify(input.token, signingKey, { algorithms: ['HS256'] }) as InviteClaims;
      } catch {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid or expired invite token' });
      }

      const now = new Date().toISOString();
      // Single-use enforcement: conditional write fails if usedAt is already set.
      try {
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: `INVITE#${claims.tokenId}`, SK: 'METADATA' },
            UpdateExpression: 'SET usedAt = :now, usedBy = :u',
            ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(usedAt)',
            ExpressionAttributeValues: { ':now': now, ':u': ctx.userId },
          }),
        );
      } catch (err) {
        if ((err as Error).name === 'ConditionalCheckFailedException') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Invite has already been used' });
        }
        throw err;
      }

      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: `USER#${ctx.userId}`, SK: 'METADATA' },
          UpdateExpression: 'SET householdId = :h, #role = :r, updatedAt = :now ADD version :one',
          ExpressionAttributeNames: { '#role': 'role' },
          ExpressionAttributeValues: {
            ':h': claims.householdId,
            ':r': 'member',
            ':now': now,
            ':one': 1,
          },
        }),
      );
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: `HOUSEHOLD#${claims.householdId}`, SK: 'METADATA' },
          UpdateExpression: 'SET memberIds = list_append(memberIds, :m), updatedAt = :now',
          ExpressionAttributeValues: { ':m': [ctx.userId], ':now': now },
        }),
      );
      await setHouseholdClaim(ctx.userId, claims.householdId);

      const household = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: `HOUSEHOLD#${claims.householdId}`, SK: 'METADATA' },
        }),
      );

      return {
        householdId: claims.householdId,
        name: (household.Item as HouseholdRecord | undefined)?.name ?? '',
        role: 'member',
        tokens: await maybeRefreshedTokens(input.refreshToken),
      };
    }),

  // GET /household — the caller's household with its members.
  get: protectedProcedure.query(async ({ ctx }): Promise<HouseholdGetResponse> => {
    if (!ctx.householdId) throw new TRPCError({ code: 'NOT_FOUND', message: 'User has no household' });

    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `HOUSEHOLD#${ctx.householdId}`, SK: 'METADATA' },
      }),
    );
    if (!result.Item) throw new TRPCError({ code: 'NOT_FOUND', message: 'Household not found' });
    const household = result.Item as HouseholdRecord;

    const memberKeys = household.memberIds.map((id) => ({ PK: `USER#${id}`, SK: 'METADATA' }));
    const members = memberKeys.length
      ? await docClient.send(
          new BatchGetCommand({ RequestItems: { [TABLE_NAME]: { Keys: memberKeys } } }),
        )
      : { Responses: { [TABLE_NAME]: [] } };

    return {
      householdId: household.householdId,
      name: household.name,
      members: ((members.Responses?.[TABLE_NAME] ?? []) as UserRecord[]).map((u) => ({
        userId: u.userId,
        name: u.name,
        email: u.email,
        photoUrl: u.photoUrl,
        role: u.role,
      })),
    };
  }),
});

export type HouseholdRouter = typeof householdRouter;
