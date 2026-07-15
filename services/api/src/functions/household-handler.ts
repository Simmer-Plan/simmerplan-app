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

// Household management (SIM-29): create, invite, join, get.
// Route: /household/{proxy+} — behind the Lambda authorizer.

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { BatchGetCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import type {
  HouseholdCreateRequest,
  HouseholdCreateResponse,
  HouseholdGetResponse,
  HouseholdInviteResponse,
  HouseholdJoinRequest,
  HouseholdJoinResponse,
  HouseholdRecord,
  InviteRecord,
  UserRecord,
} from '@simmerplan/types';
import { docClient, TABLE_NAME } from '../lib/dynamo';
import { refreshTokens, setHouseholdClaim } from '../lib/cognito';
import { getSecret } from '../lib/secrets';
import { authContext, errorResponse, HttpError, json, parseBody, routeKey } from '../lib/http';

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
    throw new HttpError(401, 'Invalid refresh token');
  });
}

async function getUser(userId: string): Promise<UserRecord> {
  const result = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: `USER#${userId}`, SK: 'METADATA' } }),
  );
  if (!result.Item) throw new HttpError(404, 'User record not found');
  return result.Item as UserRecord;
}

async function handleCreate(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const ctx = authContext(event);
  if (ctx.householdId) throw new HttpError(409, 'User already belongs to a household');
  const body = parseBody<HouseholdCreateRequest>(event);
  if (!body.name?.trim()) throw new HttpError(400, 'name is required');

  const householdId = randomUUID();
  const now = new Date().toISOString();
  const household: HouseholdRecord & { PK: string; SK: string } = {
    PK: `HOUSEHOLD#${householdId}`,
    SK: 'METADATA',
    householdId,
    name: body.name.trim(),
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

  const response: HouseholdCreateResponse = {
    householdId,
    name: household.name,
    role: 'owner',
    tokens: await maybeRefreshedTokens(body.refreshToken),
  };
  return json(201, response);
}

async function handleInvite(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const ctx = authContext(event);
  if (!ctx.householdId) throw new HttpError(403, 'User has no household');
  const user = await getUser(ctx.userId);
  if (user.role !== 'owner') throw new HttpError(403, 'Only the household owner can invite');

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

  const response: HouseholdInviteResponse = {
    inviteUrl: inviteUrl(token),
    expiresAt: expiresAt.toISOString(),
  };
  return json(201, response);
}

async function handleJoin(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const ctx = authContext(event);
  if (ctx.householdId) throw new HttpError(409, 'User already belongs to a household');
  const body = parseBody<HouseholdJoinRequest>(event);
  if (!body.token) throw new HttpError(400, 'token is required');

  const signingKey = await getSecret(INVITE_SECRET);
  let claims: InviteClaims;
  try {
    claims = jwt.verify(body.token, signingKey, { algorithms: ['HS256'] }) as InviteClaims;
  } catch {
    throw new HttpError(401, 'Invalid or expired invite token');
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
      throw new HttpError(409, 'Invite has already been used');
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

  const response: HouseholdJoinResponse = {
    householdId: claims.householdId,
    name: (household.Item as HouseholdRecord | undefined)?.name ?? '',
    role: 'member',
    tokens: await maybeRefreshedTokens(body.refreshToken),
  };
  return json(200, response);
}

async function handleGet(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const ctx = authContext(event);
  if (!ctx.householdId) throw new HttpError(404, 'User has no household');

  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `HOUSEHOLD#${ctx.householdId}`, SK: 'METADATA' },
    }),
  );
  if (!result.Item) throw new HttpError(404, 'Household not found');
  const household = result.Item as HouseholdRecord;

  const memberKeys = household.memberIds.map((id) => ({ PK: `USER#${id}`, SK: 'METADATA' }));
  const members = memberKeys.length
    ? await docClient.send(
        new BatchGetCommand({ RequestItems: { [TABLE_NAME]: { Keys: memberKeys } } }),
      )
    : { Responses: { [TABLE_NAME]: [] } };

  const response: HouseholdGetResponse = {
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
  return json(200, response);
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    switch (routeKey(event)) {
      case 'POST /household/create':
        return await handleCreate(event);
      case 'POST /household/invite':
        return await handleInvite(event);
      case 'POST /household/join':
        return await handleJoin(event);
      case 'GET /household':
        return await handleGet(event);
      default:
        throw new HttpError(404, 'Not found');
    }
  } catch (err) {
    return errorResponse(err);
  }
};
