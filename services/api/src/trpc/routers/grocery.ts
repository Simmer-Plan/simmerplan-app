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

// Grocery / shopping-list router (SIM-17): generate a list from a week's meal
// plan (recipe ingredients minus pantry stock), add items manually, tick items
// off, and push purchased items into the pantry. Behind the Lambda authorizer;
// keys scoped to HOUSEHOLD#<householdId>#GROCERY.

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import type {
  GroceryItemRecord,
  MealPlanRecord,
  PantryItemRecord,
  RecipeRecord,
} from '@simmerplan/types';
import { docClient, TABLE_NAME } from '../../lib/dynamo';
import { computeShoppingList, sectionFor } from '../../lib/shopping';
import { protectedProcedure, router } from '../trpc';

const UNITS = ['count', 'lb', 'oz', 'g', 'kg', 'ml', 'l', 'cup', 'tbsp', 'tsp'] as const;

const groceryPK = (hid: string) => `HOUSEHOLD#${hid}#GROCERY`;
const grocerySK = (id: string) => `ITEM#${id}`;
const pantryPK = (hid: string) => `HOUSEHOLD#${hid}#PANTRY`;

function requireHousehold(ctx: { householdId: string }): string {
  if (!ctx.householdId) throw new TRPCError({ code: 'FORBIDDEN', message: 'User has no household' });
  return ctx.householdId;
}

type GroceryItemDTO = Omit<GroceryItemRecord, 'householdId'>;

function toDTO(r: GroceryItemRecord): GroceryItemDTO {
  return {
    groceryItemId: r.groceryItemId,
    name: r.name,
    quantity: r.quantity ?? null,
    unit: r.unit ?? null,
    section: r.section,
    checked: r.checked,
    source: r.source,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function sortItems(items: GroceryItemDTO[]): GroceryItemDTO[] {
  return items.sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name));
}

async function listRaw(hid: string): Promise<GroceryItemRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': groceryPK(hid) },
    }),
  );
  return (result.Items ?? []) as GroceryItemRecord[];
}

function newItem(
  hid: string,
  fields: { name: string; quantity: number | null; unit: (typeof UNITS)[number] | null; source: 'auto' | 'manual' },
): GroceryItemRecord & { PK: string; SK: string } {
  const groceryItemId = randomUUID();
  const now = new Date().toISOString();
  return {
    PK: groceryPK(hid),
    SK: grocerySK(groceryItemId),
    groceryItemId,
    householdId: hid,
    name: fields.name,
    quantity: fields.quantity,
    unit: fields.unit,
    section: sectionFor(fields.name),
    checked: false,
    source: fields.source,
    createdAt: now,
    updatedAt: now,
  };
}

export const groceryRouter = router({
  list: protectedProcedure.query(async ({ ctx }): Promise<GroceryItemDTO[]> => {
    const hid = requireHousehold(ctx);
    return sortItems((await listRaw(hid)).map(toDTO));
  }),

  addItem: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(200),
        quantity: z.number().nonnegative().nullable().default(null),
        unit: z.enum(UNITS).nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<GroceryItemDTO> => {
      const hid = requireHousehold(ctx);
      const item = newItem(hid, { ...input, source: 'manual' });
      await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
      return toDTO(item);
    }),

  toggleItem: protectedProcedure
    .input(z.object({ groceryItemId: z.string().min(1), checked: z.boolean() }))
    .mutation(async ({ ctx, input }): Promise<{ groceryItemId: string; checked: boolean }> => {
      const hid = requireHousehold(ctx);
      await docClient
        .send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { PK: groceryPK(hid), SK: grocerySK(input.groceryItemId) },
            UpdateExpression: 'SET checked = :c, updatedAt = :now',
            ConditionExpression: 'attribute_exists(PK)',
            ExpressionAttributeValues: { ':c': input.checked, ':now': new Date().toISOString() },
          }),
        )
        .catch((err: Error) => {
          if (err.name === 'ConditionalCheckFailedException') {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Grocery item not found' });
          }
          throw err;
        });
      return { groceryItemId: input.groceryItemId, checked: input.checked };
    }),

  deleteItem: protectedProcedure
    .input(z.object({ groceryItemId: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<{ groceryItemId: string }> => {
      const hid = requireHousehold(ctx);
      await docClient.send(
        new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: groceryPK(hid), SK: grocerySK(input.groceryItemId) } }),
      );
      return { groceryItemId: input.groceryItemId };
    }),

  // Regenerate the auto (meal-plan-derived) portion of the list from a week's
  // plan: planned recipes' ingredients minus current pantry stock. Manual items
  // are preserved.
  generateFromWeek: protectedProcedure
    .input(z.object({ weekStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .mutation(async ({ ctx, input }): Promise<GroceryItemDTO[]> => {
      const hid = requireHousehold(ctx);

      const [weekResult, recipesResult, pantryResult, existing] = await Promise.all([
        docClient.send(
          new GetCommand({ TableName: TABLE_NAME, Key: { PK: `HOUSEHOLD#${hid}#MEAL_PLANS`, SK: `PLAN#${input.weekStartDate}` } }),
        ),
        docClient.send(
          new QueryCommand({ TableName: TABLE_NAME, KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': `HOUSEHOLD#${hid}#RECIPES` } }),
        ),
        docClient.send(
          new QueryCommand({ TableName: TABLE_NAME, KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': pantryPK(hid) } }),
        ),
        listRaw(hid),
      ]);

      const week = weekResult.Item as MealPlanRecord | undefined;
      const plannedIds = new Set(
        Object.values(week?.slots ?? {})
          .map((s) => s.recipeId)
          .filter((id): id is string => !!id),
      );
      const plannedRecipes = ((recipesResult.Items ?? []) as RecipeRecord[])
        .filter((r) => plannedIds.has(r.recipeId))
        .map((r) => ({ ingredients: (r.ingredients ?? []).map((i) => i.name) }));
      const pantryNames = ((pantryResult.Items ?? []) as PantryItemRecord[]).map((p) => p.name);

      const gaps = computeShoppingList(plannedRecipes, pantryNames);

      // Replace existing auto items; keep manual ones.
      const manual = existing.filter((i) => i.source === 'manual');
      await Promise.all(
        existing
          .filter((i) => i.source === 'auto')
          .map((i) => docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: groceryPK(hid), SK: grocerySK(i.groceryItemId) } }))),
      );
      const created = gaps.map((name) => newItem(hid, { name, quantity: null, unit: null, source: 'auto' }));
      await Promise.all(created.map((item) => docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }))));

      return sortItems([...manual, ...created].map(toDTO));
    }),

  // Move checked items into the pantry, then remove them from the list.
  purchaseChecked: protectedProcedure.mutation(async ({ ctx }): Promise<GroceryItemDTO[]> => {
    const hid = requireHousehold(ctx);
    const items = await listRaw(hid);
    const checked = items.filter((i) => i.checked);

    for (const item of checked) {
      const now = new Date().toISOString();
      const itemId = randomUUID();
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: pantryPK(hid),
            SK: `ITEM#${itemId}`,
            itemId,
            householdId: hid,
            name: item.name,
            locationId: null,
            quantity: item.quantity ?? 1,
            unit: item.unit ?? 'count',
            expiryDate: null,
            createdAt: now,
            updatedAt: now,
          } satisfies PantryItemRecord & { PK: string; SK: string },
        }),
      );
      await docClient.send(
        new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: groceryPK(hid), SK: grocerySK(item.groceryItemId) } }),
      );
    }

    return sortItems(items.filter((i) => !i.checked).map(toDTO));
  }),
});

export type GroceryRouter = typeof groceryRouter;
