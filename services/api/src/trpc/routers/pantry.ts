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

// Pantry router (SIM-9): storage locations + pantry items CRUD. Behind the
// Lambda authorizer — householdId comes from ctx, never the request body. All
// keys are scoped to HOUSEHOLD#<householdId> so data is shared within a
// household and isolated between households.

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { DeleteCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import type { PantryItemRecord, StorageLocationRecord } from '@simmerplan/types';
import { docClient, TABLE_NAME } from '../../lib/dynamo';
import { protectedProcedure, router } from '../trpc';

const LOCATION_KINDS = ['cupboard', 'fridge', 'freezer', 'pantry', 'custom'] as const;
const UNITS = ['count', 'lb', 'oz', 'g', 'kg', 'ml', 'l', 'cup', 'tbsp', 'tsp'] as const;

const locationsPK = (hid: string) => `HOUSEHOLD#${hid}#STORAGE_LOCATIONS`;
const pantryPK = (hid: string) => `HOUSEHOLD#${hid}#PANTRY`;

/** householdId is required for every pantry operation. */
function requireHousehold(ctx: { householdId: string }): string {
  if (!ctx.householdId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'User has no household' });
  }
  return ctx.householdId;
}

type StorageLocationDTO = Omit<StorageLocationRecord, 'householdId'>;
type PantryItemDTO = Omit<PantryItemRecord, 'householdId'>;

const itemInput = z.object({
  name: z.string().trim().min(1).max(200),
  locationId: z.string().min(1).nullable().default(null),
  quantity: z.number().nonnegative().default(1),
  unit: z.enum(UNITS).default('count'),
  // ISO date (YYYY-MM-DD) or null.
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expiryDate must be YYYY-MM-DD')
    .nullable()
    .default(null),
});

export const pantryRouter = router({
  // --- Storage locations ---------------------------------------------------

  listLocations: protectedProcedure.query(async ({ ctx }): Promise<StorageLocationDTO[]> => {
    const hid = requireHousehold(ctx);
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': locationsPK(hid) },
      }),
    );
    return ((result.Items ?? []) as StorageLocationRecord[]).map(toLocationDTO);
  }),

  createLocation: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(120), kind: z.enum(LOCATION_KINDS) }))
    .mutation(async ({ ctx, input }): Promise<StorageLocationDTO> => {
      const hid = requireHousehold(ctx);
      const locationId = randomUUID();
      const now = new Date().toISOString();
      const record: StorageLocationRecord & { PK: string; SK: string } = {
        PK: locationsPK(hid),
        SK: `LOCATION#${locationId}`,
        locationId,
        householdId: hid,
        name: input.name,
        kind: input.kind,
        createdAt: now,
        updatedAt: now,
      };
      await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: record }));
      return toLocationDTO(record);
    }),

  deleteLocation: protectedProcedure
    .input(z.object({ locationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<{ locationId: string }> => {
      const hid = requireHousehold(ctx);
      await docClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { PK: locationsPK(hid), SK: `LOCATION#${input.locationId}` },
        }),
      );
      return { locationId: input.locationId };
    }),

  // --- Pantry items --------------------------------------------------------

  listItems: protectedProcedure
    .input(z.object({ locationId: z.string().min(1).optional(), search: z.string().optional() }).optional())
    .query(async ({ ctx, input }): Promise<PantryItemDTO[]> => {
      const hid = requireHousehold(ctx);
      const result = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': pantryPK(hid) },
        }),
      );
      let items = ((result.Items ?? []) as PantryItemRecord[]).map(toItemDTO);
      if (input?.locationId) items = items.filter((i) => i.locationId === input.locationId);
      if (input?.search) {
        const q = input.search.trim().toLowerCase();
        if (q) items = items.filter((i) => i.name.toLowerCase().includes(q));
      }
      return items.sort((a, b) => a.name.localeCompare(b.name));
    }),

  createItem: protectedProcedure
    .input(itemInput)
    .mutation(async ({ ctx, input }): Promise<PantryItemDTO> => {
      const hid = requireHousehold(ctx);
      const itemId = randomUUID();
      const now = new Date().toISOString();
      const record: PantryItemRecord & { PK: string; SK: string } = {
        PK: pantryPK(hid),
        SK: `ITEM#${itemId}`,
        itemId,
        householdId: hid,
        name: input.name,
        locationId: input.locationId,
        quantity: input.quantity,
        unit: input.unit,
        expiryDate: input.expiryDate,
        createdAt: now,
        updatedAt: now,
      };
      await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: record }));
      return toItemDTO(record);
    }),

  updateItem: protectedProcedure
    .input(itemInput.partial().extend({ itemId: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<PantryItemDTO> => {
      const hid = requireHousehold(ctx);
      const { itemId, ...fields } = input;

      // Build a partial SET from only the provided fields.
      const sets: string[] = ['updatedAt = :now'];
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = { ':now': new Date().toISOString() };
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) continue;
        names[`#${key}`] = key;
        values[`:${key}`] = value;
        sets.push(`#${key} = :${key}`);
      }

      const result = await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: pantryPK(hid), SK: `ITEM#${itemId}` },
          UpdateExpression: `SET ${sets.join(', ')}`,
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
          ExpressionAttributeValues: values,
          ReturnValues: 'ALL_NEW',
        }),
      ).catch((err: Error) => {
        if (err.name === 'ConditionalCheckFailedException') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Pantry item not found' });
        }
        throw err;
      });
      return toItemDTO(result.Attributes as PantryItemRecord);
    }),

  deleteItem: protectedProcedure
    .input(z.object({ itemId: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<{ itemId: string }> => {
      const hid = requireHousehold(ctx);
      await docClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { PK: pantryPK(hid), SK: `ITEM#${input.itemId}` },
        }),
      );
      return { itemId: input.itemId };
    }),
});

function toLocationDTO(r: StorageLocationRecord): StorageLocationDTO {
  return {
    locationId: r.locationId,
    name: r.name,
    kind: r.kind,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toItemDTO(r: PantryItemRecord): PantryItemDTO {
  return {
    itemId: r.itemId,
    name: r.name,
    locationId: r.locationId ?? null,
    quantity: r.quantity,
    unit: r.unit,
    expiryDate: r.expiryDate ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export type PantryRouter = typeof pantryRouter;
