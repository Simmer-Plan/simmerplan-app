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

// Exercises the grocery tRPC router through the deployed Lambda handler.

import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler } from '../src/functions/grocery-handler';

const ddb = mockClient(DynamoDBDocumentClient);

type Ctx = { userId: string; householdId: string };

function trpcEvent(method: 'GET' | 'POST', procedure: string, input: unknown, ctx: Ctx): APIGatewayProxyEventV2 {
  const rawPath = `/grocery/${procedure}`;
  const isQuery = method === 'GET';
  const rawQueryString =
    isQuery && input !== undefined ? `input=${encodeURIComponent(JSON.stringify(input))}` : '';
  return {
    version: '2.0',
    routeKey: `${method} /grocery/{proxy+}`,
    rawPath,
    rawQueryString,
    headers: { 'content-type': 'application/json' },
    pathParameters: { proxy: procedure },
    isBase64Encoded: false,
    body: !isQuery && input !== undefined ? JSON.stringify(input) : undefined,
    requestContext: { domainName: 'api.test', http: { method, path: rawPath }, authorizer: { lambda: ctx } },
  } as unknown as APIGatewayProxyEventV2;
}

type TrpcError = { message: string; code: number; data?: { code?: string } };

async function call<T = unknown>(
  method: 'GET' | 'POST',
  procedure: string,
  input: unknown,
  ctx: Ctx,
): Promise<{ status: number; data: T; error?: TrpcError }> {
  const result = (await handler(trpcEvent(method, procedure, input, ctx), {} as never)) as {
    statusCode: number;
    body: string;
  };
  const parsed = JSON.parse(result.body) as { result?: { data: T }; error?: TrpcError };
  return { status: result.statusCode, data: parsed.result?.data as T, error: parsed.error };
}

const WITH_HH: Ctx = { userId: 'u1', householdId: 'hh-1' };
const GROCERY_PK = 'HOUSEHOLD#hh-1#GROCERY';

beforeEach(() => {
  ddb.reset();
});

describe('grocery.addItem / list', () => {
  it('adds a manual item with a computed section', async () => {
    ddb.on(PutCommand).resolves({});
    const { status, data } = await call<{ name: string; section: string; source: string; checked: boolean }>(
      'POST',
      'addItem',
      { name: 'Bananas' },
      WITH_HH,
    );
    expect(status).toBe(200);
    expect(data).toMatchObject({ name: 'Bananas', section: 'produce', source: 'manual', checked: false });
  });

  it('lists items sorted by section then name', async () => {
    ddb.on(QueryCommand).resolves({
      Items: [
        { groceryItemId: 'g1', name: 'Zucchini', section: 'produce', checked: false, source: 'manual' },
        { groceryItemId: 'g2', name: 'Milk', section: 'dairy', checked: false, source: 'auto' },
      ],
    });
    const { data } = await call<{ name: string }[]>('GET', 'list', undefined, WITH_HH);
    expect(data.map((i) => i.name)).toEqual(['Milk', 'Zucchini']); // dairy < produce
  });
});

describe('grocery.generateFromWeek', () => {
  it('creates auto items for planned-recipe gaps and keeps manual items', async () => {
    ddb.on(GetCommand).resolves({
      Item: { slots: { 'mon:dinner': { recipeId: 'r1', recipeName: 'Chili', note: '' } } },
    });
    ddb.on(QueryCommand, { ExpressionAttributeValues: { ':pk': 'HOUSEHOLD#hh-1#RECIPES' } }).resolves({
      Items: [
        { recipeId: 'r1', name: 'Chili', ingredients: [{ name: 'Beans' }, { name: 'Onion' }] },
        { recipeId: 'r2', name: 'Unused', ingredients: [{ name: 'Caviar' }] },
      ],
    });
    ddb.on(QueryCommand, { ExpressionAttributeValues: { ':pk': 'HOUSEHOLD#hh-1#PANTRY' } }).resolves({
      Items: [{ itemId: 'p1', name: 'Onion' }],
    });
    ddb.on(QueryCommand, { ExpressionAttributeValues: { ':pk': GROCERY_PK } }).resolves({
      Items: [{ groceryItemId: 'm1', name: 'Napkins', section: 'other', checked: false, source: 'manual' }],
    });
    ddb.on(PutCommand).resolves({});
    ddb.on(DeleteCommand).resolves({});

    const { status, data } = await call<{ name: string; source: string }[]>(
      'POST',
      'generateFromWeek',
      { weekStartDate: '2026-09-07' },
      WITH_HH,
    );
    expect(status).toBe(200);
    const names = data.map((i) => i.name).sort();
    // Beans is a gap (Onion in pantry); Caviar excluded (recipe not planned); Napkins kept.
    expect(names).toContain('Beans');
    expect(names).toContain('Napkins');
    expect(names).not.toContain('Onion');
    expect(names).not.toContain('Caviar');
  });
});

describe('grocery.toggleItem / deleteItem', () => {
  it('toggles checked', async () => {
    ddb.on(UpdateCommand).resolves({});
    const { status, data } = await call<{ checked: boolean }>('POST', 'toggleItem', { groceryItemId: 'g1', checked: true }, WITH_HH);
    expect(status).toBe(200);
    expect(data.checked).toBe(true);
  });

  it('404s toggling a missing item', async () => {
    ddb.on(UpdateCommand).rejects(Object.assign(new Error('x'), { name: 'ConditionalCheckFailedException' }));
    const { status } = await call('POST', 'toggleItem', { groceryItemId: 'nope', checked: true }, WITH_HH);
    expect(status).toBe(404);
  });

  it('deletes an item', async () => {
    ddb.on(DeleteCommand).resolves({});
    const { status, data } = await call<{ groceryItemId: string }>('POST', 'deleteItem', { groceryItemId: 'g1' }, WITH_HH);
    expect(status).toBe(200);
    expect(data.groceryItemId).toBe('g1');
  });
});

describe('grocery.purchaseChecked', () => {
  it('moves checked items to the pantry and drops them from the list', async () => {
    ddb.on(QueryCommand).resolves({
      Items: [
        { groceryItemId: 'g1', name: 'Beans', section: 'pantry', checked: true, source: 'auto', quantity: null, unit: null },
        { groceryItemId: 'g2', name: 'Milk', section: 'dairy', checked: false, source: 'manual', quantity: null, unit: null },
      ],
    });
    ddb.on(PutCommand).resolves({});
    ddb.on(DeleteCommand).resolves({});

    const { status, data } = await call<{ name: string }[]>('POST', 'purchaseChecked', undefined, WITH_HH);
    expect(status).toBe(200);
    expect(data.map((i) => i.name)).toEqual(['Milk']); // only the unchecked item remains
    // one pantry PutCommand + one grocery DeleteCommand for the checked item
    expect(ddb.commandCalls(PutCommand)).toHaveLength(1);
    expect(ddb.commandCalls(DeleteCommand)).toHaveLength(1);
  });
});

describe('auth guards', () => {
  it('403s without a household', async () => {
    const { status } = await call('GET', 'list', undefined, { userId: 'u1', householdId: '' });
    expect(status).toBe(403);
  });

  it('401s without a userId', async () => {
    const { status } = await call('GET', 'list', undefined, { userId: '', householdId: '' });
    expect(status).toBe(401);
  });
});
