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
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import type { PantryItemRecord, RecipeAvailability, RecipeRecord } from '@simmerplan/types';
import { docClient, TABLE_NAME } from '../../lib/dynamo';
import { protectedProcedure, router } from '../trpc';

const UNITS = ['count', 'lb', 'oz', 'g', 'kg', 'ml', 'l', 'cup', 'tbsp', 'tsp'] as const;
const COMPLEXITY = ['simple', 'moderate', 'complex'] as const;

const recipesPK = (hid: string) => `HOUSEHOLD#${hid}#RECIPES`;
const recipeSK = (recipeId: string) => `RECIPE#${recipeId}`;
const pantryPK = (hid: string) => `HOUSEHOLD#${hid}#PANTRY`;

function requireHousehold(ctx: { householdId: string }): string {
  if (!ctx.householdId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'User has no household' });
  }
  return ctx.householdId;
}

type RecipeDTO = Omit<RecipeRecord, 'householdId'>;
type RecipeWithAvailability = RecipeDTO & { availability: RecipeAvailability };

/** Compute how many of a recipe's ingredients are covered by current pantry stock. */
function availabilityFor(
  recipe: RecipeDTO,
  pantryIds: Set<string>,
  pantryNames: Set<string>,
): RecipeAvailability {
  const total = recipe.ingredients.length;
  const available = recipe.ingredients.filter(
    (ing) =>
      (ing.pantryItemId != null && pantryIds.has(ing.pantryItemId)) ||
      pantryNames.has(ing.name.trim().toLowerCase()),
  ).length;
  return { totalCount: total, availableCount: available, makeable: total > 0 && available === total };
}

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
        favourite: false,
        lastUsedAt: null,
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
        // favourite/lastUsedAt are managed by dedicated mutations — preserve
        // them across a full-document editor save.
        favourite: prev.favourite ?? false,
        lastUsedAt: prev.lastUsedAt ?? null,
        createdAt: prev.createdAt,
        updatedAt: new Date().toISOString(),
      };
      await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: record }));
      return toDTO(record);
    }),

  // Toggle the household favourite flag.
  setFavourite: protectedProcedure
    .input(z.object({ recipeId: z.string().min(1), favourite: z.boolean() }))
    .mutation(async ({ ctx, input }): Promise<{ recipeId: string; favourite: boolean }> => {
      const hid = requireHousehold(ctx);
      await docClient
        .send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: recipesPK(hid), SK: recipeSK(input.recipeId) },
            UpdateExpression: 'SET favourite = :f, updatedAt = :now',
            ConditionExpression: 'attribute_exists(PK)',
            ExpressionAttributeValues: { ':f': input.favourite, ':now': new Date().toISOString() },
          }),
        )
        .catch((err: Error) => {
          if (err.name === 'ConditionalCheckFailedException') {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Recipe not found' });
          }
          throw err;
        });
      return { recipeId: input.recipeId, favourite: input.favourite };
    }),

  // Record that the recipe was cooked/used now (drives "recently used").
  markUsed: protectedProcedure
    .input(z.object({ recipeId: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<{ recipeId: string; lastUsedAt: string }> => {
      const hid = requireHousehold(ctx);
      const now = new Date().toISOString();
      await docClient
        .send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: recipesPK(hid), SK: recipeSK(input.recipeId) },
            UpdateExpression: 'SET lastUsedAt = :now, updatedAt = :now',
            ConditionExpression: 'attribute_exists(PK)',
            ExpressionAttributeValues: { ':now': now },
          }),
        )
        .catch((err: Error) => {
          if (err.name === 'ConditionalCheckFailedException') {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Recipe not found' });
          }
          throw err;
        });
      return { recipeId: input.recipeId, lastUsedAt: now };
    }),

  // Browse/search with pantry availability + filters (SIM-13).
  search: protectedProcedure
    .input(
      z
        .object({
          text: z.string().optional(),
          complexity: z.enum(COMPLEXITY).optional(),
          tags: z.array(z.string()).optional(),
          maxTotalMinutes: z.number().int().nonnegative().optional(),
          makeableOnly: z.boolean().optional(),
          favouritesOnly: z.boolean().optional(),
          sort: z.enum(['name', 'recent', 'availability']).default('name'),
        })
        .optional(),
    )
    .query(async ({ ctx, input }): Promise<RecipeWithAvailability[]> => {
      const hid = requireHousehold(ctx);
      const opts = input ?? { sort: 'name' as const };

      const [recipesResult, pantryResult] = await Promise.all([
        docClient.send(
          new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: { ':pk': recipesPK(hid) },
          }),
        ),
        docClient.send(
          new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: { ':pk': pantryPK(hid) },
          }),
        ),
      ]);

      const pantryItems = (pantryResult.Items ?? []) as PantryItemRecord[];
      const pantryIds = new Set(pantryItems.map((p) => p.itemId));
      const pantryNames = new Set(pantryItems.map((p) => p.name.trim().toLowerCase()));

      let rows = ((recipesResult.Items ?? []) as RecipeRecord[]).map((r) => {
        const dto = toDTO(r);
        return { ...dto, availability: availabilityFor(dto, pantryIds, pantryNames) };
      });

      if (opts.text) {
        const q = opts.text.trim().toLowerCase();
        if (q) {
          rows = rows.filter(
            (r) => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q),
          );
        }
      }
      if (opts.complexity) rows = rows.filter((r) => r.complexity === opts.complexity);
      if (opts.tags?.length) {
        const wanted = opts.tags.map((t) => t.toLowerCase());
        rows = rows.filter((r) => {
          const have = r.tags.map((t) => t.toLowerCase());
          return wanted.every((t) => have.includes(t));
        });
      }
      if (opts.maxTotalMinutes != null) {
        rows = rows.filter(
          (r) => (r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0) <= opts.maxTotalMinutes!,
        );
      }
      if (opts.makeableOnly) rows = rows.filter((r) => r.availability.makeable);
      if (opts.favouritesOnly) rows = rows.filter((r) => r.favourite);

      rows.sort((a, b) => {
        if (opts.sort === 'recent') return (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '');
        if (opts.sort === 'availability') {
          const av = (r: RecipeWithAvailability) =>
            r.availability.totalCount === 0 ? 0 : r.availability.availableCount / r.availability.totalCount;
          return av(b) - av(a);
        }
        return a.name.localeCompare(b.name);
      });

      return rows;
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
    favourite: r.favourite ?? false,
    lastUsedAt: r.lastUsedAt ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export type RecipeRouter = typeof recipeRouter;
