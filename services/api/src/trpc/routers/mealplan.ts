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

// Meal plan router (SIM-16): a week's plan is one item keyed by its Monday,
// with an embedded map of slots (`${day}:${mealType}`). Behind the Lambda
// authorizer; keys scoped to HOUSEHOLD#<householdId>#MEAL_PLANS.

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type {
  MealPlanRecord,
  MealPlanWeek,
  MealSuggestion,
  PantryItemRecord,
  RecipeRecord,
  UserRecord,
} from '@simmerplan/types';
import { DAYS_OF_WEEK, DEFAULT_DIETARY_PREFERENCES, MEAL_TYPES } from '@simmerplan/types';
import { docClient, TABLE_NAME } from '../../lib/dynamo';
import { generateMealSuggestions } from '../../lib/bedrock';
import { protectedProcedure, router } from '../trpc';

const plansPK = (hid: string) => `HOUSEHOLD#${hid}#MEAL_PLANS`;
const planSK = (weekStartDate: string) => `PLAN#${weekStartDate}`;
const slotKey = (day: string, mealType: string) => `${day}:${mealType}`;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'weekStartDate must be YYYY-MM-DD');
const dayEnum = z.enum(DAYS_OF_WEEK as [string, ...string[]]);
const mealEnum = z.enum(MEAL_TYPES as [string, ...string[]]);

function requireHousehold(ctx: { householdId: string }): string {
  if (!ctx.householdId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'User has no household' });
  }
  return ctx.householdId;
}

async function loadWeek(hid: string, weekStartDate: string): Promise<MealPlanRecord | null> {
  const result = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: plansPK(hid), SK: planSK(weekStartDate) } }),
  );
  return (result.Item as MealPlanRecord | undefined) ?? null;
}

function toWeek(weekStartDate: string, record: MealPlanRecord | null): MealPlanWeek {
  return { weekStartDate, slots: record?.slots ?? {} };
}

async function saveWeek(hid: string, weekStartDate: string, record: MealPlanRecord | null, slots: MealPlanRecord['slots']): Promise<MealPlanWeek> {
  const now = new Date().toISOString();
  const item: MealPlanRecord & { PK: string; SK: string } = {
    PK: plansPK(hid),
    SK: planSK(weekStartDate),
    householdId: hid,
    weekStartDate,
    slots,
    createdAt: record?.createdAt ?? now,
    updatedAt: now,
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return { weekStartDate, slots };
}

export const mealplanRouter = router({
  getWeek: protectedProcedure
    .input(z.object({ weekStartDate: isoDate }))
    .query(async ({ ctx, input }): Promise<MealPlanWeek> => {
      const hid = requireHousehold(ctx);
      return toWeek(input.weekStartDate, await loadWeek(hid, input.weekStartDate));
    }),

  setSlot: protectedProcedure
    .input(
      z.object({
        weekStartDate: isoDate,
        day: dayEnum,
        mealType: mealEnum,
        recipeId: z.string().min(1).nullable().default(null),
        recipeName: z.string().trim().max(200).default(''),
        note: z.string().max(500).default(''),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<MealPlanWeek> => {
      const hid = requireHousehold(ctx);
      const record = await loadWeek(hid, input.weekStartDate);
      const slots = { ...(record?.slots ?? {}) };
      slots[slotKey(input.day, input.mealType)] = {
        recipeId: input.recipeId,
        recipeName: input.recipeName,
        note: input.note,
      };
      return saveWeek(hid, input.weekStartDate, record, slots);
    }),

  clearSlot: protectedProcedure
    .input(z.object({ weekStartDate: isoDate, day: dayEnum, mealType: mealEnum }))
    .mutation(async ({ ctx, input }): Promise<MealPlanWeek> => {
      const hid = requireHousehold(ctx);
      const record = await loadWeek(hid, input.weekStartDate);
      if (!record) return { weekStartDate: input.weekStartDate, slots: {} };
      const slots = { ...record.slots };
      delete slots[slotKey(input.day, input.mealType)];
      return saveWeek(hid, input.weekStartDate, record, slots);
    }),

  // AI meal suggestions (SIM-14): assembles pantry + saved recipes + the
  // caller's dietary prefs and asks Bedrock for ideas. Requires Bedrock model
  // access enabled and bedrock:InvokeModel on the Lambda role.
  suggest: protectedProcedure
    .input(
      z
        .object({ count: z.number().int().min(1).max(10).default(3), mealType: mealEnum.optional() })
        .optional(),
    )
    .mutation(async ({ ctx, input }): Promise<MealSuggestion[]> => {
      const hid = requireHousehold(ctx);
      const opts = input ?? { count: 3 };

      const [recipesResult, pantryResult, userResult] = await Promise.all([
        docClient.send(
          new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: { ':pk': `HOUSEHOLD#${hid}#RECIPES` },
          }),
        ),
        docClient.send(
          new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: { ':pk': `HOUSEHOLD#${hid}#PANTRY` },
          }),
        ),
        docClient.send(
          new GetCommand({ TableName: TABLE_NAME, Key: { PK: `USER#${ctx.userId}`, SK: 'METADATA' } }),
        ),
      ]);

      const recipes = ((recipesResult.Items ?? []) as RecipeRecord[]).map((r) => ({
        recipeId: r.recipeId,
        name: r.name,
        ingredients: (r.ingredients ?? []).map((i) => i.name),
      }));
      const pantryItemNames = ((pantryResult.Items ?? []) as PantryItemRecord[]).map((p) => p.name);
      const dietary = (userResult.Item as UserRecord | undefined)?.dietary ?? DEFAULT_DIETARY_PREFERENCES;

      try {
        return await generateMealSuggestions({
          pantryItemNames,
          recipes,
          dietary,
          count: opts.count ?? 3,
          mealType: opts.mealType,
        });
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message: `Meal suggestion failed: ${(err as Error).message}`,
        });
      }
    }),
});

export type MealplanRouter = typeof mealplanRouter;
