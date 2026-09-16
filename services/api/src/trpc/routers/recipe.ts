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

// Recipe router (SIM-11): recipe CRUD. Ingredients are embedded on the recipe
// record (atomic writes; a household's recipe/ingredient counts are small).
// Behind the Lambda authorizer — householdId comes from ctx. Keys are scoped to
// HOUSEHOLD#<householdId>#RECIPES / RECIPE#<recipeId>.

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import type { RecipeRecord } from '@simmerplan/types';
import { docClient, TABLE_NAME } from '../../lib/dynamo';
import { protectedProcedure, router } from '../trpc';

const UNITS = ['count', 'lb', 'oz', 'g', 'kg', 'ml', 'l', 'cup', 'tbsp', 'tsp'] as const;
const COMPLEXITY = ['simple', 'moderate', 'complex'] as const;

const recipesPK = (hid: string) => `HOUSEHOLD#${hid}#RECIPES`;
const recipeSK = (recipeId: string) => `RECIPE#${recipeId}`;

function requireHousehold(ctx: { householdId: string }): string {
  if (!ctx.householdId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'User has no household' });
  }
  return ctx.householdId;
}

type RecipeDTO = Omit<RecipeRecord, 'householdId'>;

const ingredientSchema = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.number().nonnegative().nullable().default(null),
  unit: z.enum(UNITS).nullable().default(null),
  pantryItemId: z.string().min(1).nullable().default(null),
});

const recipeInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).default(''),
  photoUrl: z.string().url().nullable().default(null),
  ingredients: z.array(ingredientSchema).default([]),
  instructions: z.array(z.string().trim().min(1)).default([]),
  prepTimeMinutes: z.number().int().nonnegative().nullable().default(null),
  cookTimeMinutes: z.number().int().nonnegative().nullable().default(null),
  complexity: z.enum(COMPLEXITY).default('simple'),
  tags: z.array(z.string().trim().min(1)).default([]),
});

export const recipeRouter = router({
  list: protectedProcedure.query(async ({ ctx }): Promise<RecipeDTO[]> => {
    const hid = requireHousehold(ctx);
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': recipesPK(hid) },
      }),
    );
    return ((result.Items ?? []) as RecipeRecord[])
      .map(toDTO)
      .sort((a, b) => a.name.localeCompare(b.name));
  }),

  get: protectedProcedure
    .input(z.object({ recipeId: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<RecipeDTO> => {
      const hid = requireHousehold(ctx);
      const result = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { PK: recipesPK(hid), SK: recipeSK(input.recipeId) },
        }),
      );
      if (!result.Item) throw new TRPCError({ code: 'NOT_FOUND', message: 'Recipe not found' });
      return toDTO(result.Item as RecipeRecord);
    }),

  create: protectedProcedure
    .input(recipeInput)
    .mutation(async ({ ctx, input }): Promise<RecipeDTO> => {
      const hid = requireHousehold(ctx);
      const recipeId = randomUUID();
      const now = new Date().toISOString();
      const record: RecipeRecord & { PK: string; SK: string } = {
        PK: recipesPK(hid),
        SK: recipeSK(recipeId),
        recipeId,
        householdId: hid,
        ...input,
        createdAt: now,
        updatedAt: now,
      };
      await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: record }));
      return toDTO(record);
    }),

  update: protectedProcedure
    .input(recipeInput.extend({ recipeId: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<RecipeDTO> => {
      const hid = requireHousehold(ctx);
      const { recipeId, ...fields } = input;

      const existing = await docClient.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { PK: recipesPK(hid), SK: recipeSK(recipeId) } }),
      );
      if (!existing.Item) throw new TRPCError({ code: 'NOT_FOUND', message: 'Recipe not found' });
      const prev = existing.Item as RecipeRecord;

      // Full-document replace (all recipe fields are supplied by the editor).
      const record: RecipeRecord & { PK: string; SK: string } = {
        PK: recipesPK(hid),
        SK: recipeSK(recipeId),
        recipeId,
        householdId: hid,
        ...fields,
        createdAt: prev.createdAt,
        updatedAt: new Date().toISOString(),
      };
      await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: record }));
      return toDTO(record);
    }),

  delete: protectedProcedure
    .input(z.object({ recipeId: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<{ recipeId: string }> => {
      const hid = requireHousehold(ctx);
      await docClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { PK: recipesPK(hid), SK: recipeSK(input.recipeId) },
        }),
      );
      return { recipeId: input.recipeId };
    }),
});

function toDTO(r: RecipeRecord): RecipeDTO {
  return {
    recipeId: r.recipeId,
    name: r.name,
    description: r.description,
    photoUrl: r.photoUrl ?? null,
    ingredients: r.ingredients ?? [],
    instructions: r.instructions ?? [],
    prepTimeMinutes: r.prepTimeMinutes ?? null,
    cookTimeMinutes: r.cookTimeMinutes ?? null,
    complexity: r.complexity,
    tags: r.tags ?? [],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export type RecipeRouter = typeof recipeRouter;
