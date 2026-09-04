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

// Profile router (SIM-21): the signed-in user's profile + notification
// preferences. Behind the Lambda authorizer — userId comes from ctx. Email is
// the federated Google identity and is not editable here; there is no password
// (Google sign-in), so neither is exposed as writable.

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { ProfileResponse, UserRecord } from '@simmerplan/types';
import { DEFAULT_DIETARY_PREFERENCES, DEFAULT_USER_PREFERENCES } from '@simmerplan/types';
import { docClient, TABLE_NAME } from '../../lib/dynamo';
import { protectedProcedure, router } from '../trpc';

const userKey = (userId: string) => ({ PK: `USER#${userId}`, SK: 'METADATA' });

async function loadUser(userId: string): Promise<UserRecord> {
  const result = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: userKey(userId) }));
  if (!result.Item) throw new TRPCError({ code: 'NOT_FOUND', message: 'User record not found' });
  return result.Item as UserRecord;
}

function toProfile(u: UserRecord): ProfileResponse {
  return {
    userId: u.userId,
    name: u.name,
    email: u.email,
    photoUrl: u.photoUrl,
    householdId: u.householdId,
    role: u.role,
    preferences: { ...DEFAULT_USER_PREFERENCES, ...(u.preferences ?? {}) },
    dietary: { ...DEFAULT_DIETARY_PREFERENCES, ...(u.dietary ?? {}) },
  };
}

export const profileRouter = router({
  get: protectedProcedure.query(async ({ ctx }): Promise<ProfileResponse> => {
    return toProfile(await loadUser(ctx.userId));
  }),

  updateName: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(120) }))
    .mutation(async ({ ctx, input }): Promise<ProfileResponse> => {
      const result = await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: userKey(ctx.userId),
          UpdateExpression: 'SET #name = :name, updatedAt = :now ADD version :one',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: { '#name': 'name' },
          ExpressionAttributeValues: { ':name': input.name, ':now': new Date().toISOString(), ':one': 1 },
          ReturnValues: 'ALL_NEW',
        }),
      ).catch((err: Error) => {
        if (err.name === 'ConditionalCheckFailedException') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'User record not found' });
        }
        throw err;
      });
      return toProfile(result.Attributes as UserRecord);
    }),

  updatePreferences: protectedProcedure
    .input(z.object({ weeklyPlanReminder: z.boolean(), expiryAlerts: z.boolean() }))
    .mutation(async ({ ctx, input }): Promise<ProfileResponse> => {
      const result = await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: userKey(ctx.userId),
          UpdateExpression: 'SET preferences = :prefs, updatedAt = :now',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeValues: {
            ':prefs': { weeklyPlanReminder: input.weeklyPlanReminder, expiryAlerts: input.expiryAlerts },
            ':now': new Date().toISOString(),
          },
          ReturnValues: 'ALL_NEW',
        }),
      ).catch((err: Error) => {
        if (err.name === 'ConditionalCheckFailedException') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'User record not found' });
        }
        throw err;
      });
      return toProfile(result.Attributes as UserRecord);
    }),

  updateDietary: protectedProcedure
    .input(
      z.object({
        dietType: z.string().trim().min(1).max(40),
        allergies: z.array(z.string().trim().min(1)).default([]),
        dislikedIngredients: z.array(z.string().trim().min(1)).default([]),
        cuisinePreferences: z.array(z.string().trim().min(1)).default([]),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<ProfileResponse> => {
      const result = await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: userKey(ctx.userId),
          UpdateExpression: 'SET dietary = :d, updatedAt = :now',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeValues: { ':d': input, ':now': new Date().toISOString() },
          ReturnValues: 'ALL_NEW',
        }),
      ).catch((err: Error) => {
        if (err.name === 'ConditionalCheckFailedException') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'User record not found' });
        }
        throw err;
      });
      return toProfile(result.Attributes as UserRecord);
    }),
});

export type ProfileRouter = typeof profileRouter;
