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

// Exercises the recipe tRPC router through the deployed Lambda handler.

import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler } from '../src/functions/recipe-handler';

const ddb = mockClient(DynamoDBDocumentClient);

type Ctx = { userId: string; householdId: string };

function trpcEvent(method: 'GET' | 'POST', procedure: string, input: unknown, ctx: Ctx): APIGatewayProxyEventV2 {
  const rawPath = `/recipes/${procedure}`;
  const isQuery = method === 'GET';
  const rawQueryString =
    isQuery && input !== undefined ? `input=${encodeURIComponent(JSON.stringify(input))}` : '';
  return {
    version: '2.0',
    routeKey: `${method} /recipes/{proxy+}`,
    rawPath,
    rawQueryString,
    headers: { 'content-type': 'application/json' },
    pathParameters: { proxy: procedure },
    isBase64Encoded: false,
    body: !isQuery && input !== undefined ? JSON.stringify(input) : undefined,
    requestContext: { domainName: 'api.test', http: { method, path: rawPath }, authorizer: { lambda: ctx } },
  } as unknown as APIGatewayProxyEventV2;
}

type TrpcError = { message: string; code: number; data?: { code?: string; httpStatus?: number } };

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

beforeEach(() => {
  ddb.reset();
});

describe('recipe.create', () => {
  it('creates a recipe with embedded ingredients + instructions', async () => {
    ddb.on(PutCommand).resolves({});
    const { status, data } = await call<{ recipeId: string; ingredients: unknown[]; complexity: string }>(
      'POST',
      'create',
      {
        name: 'Chili',
        description: 'Hearty',
        complexity: 'moderate',
        tags: ['comfort food', 'vegetarian'],
        ingredients: [{ name: 'Beans', quantity: 2, unit: 'cup', pantryItemId: 'p1' }],
        instructions: ['Chop', 'Simmer'],
      },
      WITH_HH,
    );
    expect(status).toBe(200);
    expect(data.recipeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(data.ingredients).toHaveLength(1);
    expect(data.complexity).toBe('moderate');
  });

  it('applies defaults for optional fields', async () => {
    ddb.on(PutCommand).resolves({});
    const { status, data } = await call<{ complexity: string; ingredients: unknown[]; tags: unknown[] }>(
      'POST',
      'create',
      { name: 'Toast' },
      WITH_HH,
    );
    expect(status).toBe(200);
    expect(data.complexity).toBe('simple');
    expect(data.ingredients).toEqual([]);
    expect(data.tags).toEqual([]);
  });

  it('rejects an invalid complexity', async () => {
    const { status } = await call('POST', 'create', { name: 'X', complexity: 'expert' }, WITH_HH);
    expect(status).toBe(400);
  });
});

describe('recipe.list / get / update / delete', () => {
  it('lists recipes sorted by name', async () => {
    ddb.on(QueryCommand).resolves({
      Items: [
        { recipeId: 'r2', householdId: 'hh-1', name: 'Ziti', complexity: 'simple', ingredients: [], instructions: [], tags: [] },
        { recipeId: 'r1', householdId: 'hh-1', name: 'Apple Pie', complexity: 'complex', ingredients: [], instructions: [], tags: [] },
      ],
    });
    const { data } = await call<{ name: string }[]>('GET', 'list', undefined, WITH_HH);
    expect(data.map((r) => r.name)).toEqual(['Apple Pie', 'Ziti']);
  });

  it('404s get for a missing recipe', async () => {
    ddb.on(GetCommand).resolves({});
    const { status, error } = await call('GET', 'get', { recipeId: 'nope' }, WITH_HH);
    expect(status).toBe(404);
    expect(error?.data?.code).toBe('NOT_FOUND');
  });

  it('updates a recipe, preserving createdAt', async () => {
    ddb.on(GetCommand).resolves({
      Item: { recipeId: 'r1', householdId: 'hh-1', name: 'Old', complexity: 'simple', ingredients: [], instructions: [], tags: [], createdAt: '2026-01-01T00:00:00.000Z' },
    });
    ddb.on(PutCommand).resolves({});
    const { status, data } = await call<{ name: string; createdAt: string }>(
      'POST',
      'update',
      { recipeId: 'r1', name: 'New' },
      WITH_HH,
    );
    expect(status).toBe(200);
    expect(data.name).toBe('New');
    expect(data.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('404s update for a missing recipe', async () => {
    ddb.on(GetCommand).resolves({});
    const { status } = await call('POST', 'update', { recipeId: 'nope', name: 'X' }, WITH_HH);
    expect(status).toBe(404);
  });

  it('deletes a recipe', async () => {
    ddb.on(DeleteCommand).resolves({});
    const { status, data } = await call<{ recipeId: string }>('POST', 'delete', { recipeId: 'r1' }, WITH_HH);
    expect(status).toBe(200);
    expect(data.recipeId).toBe('r1');
  });
});

describe('auth guards', () => {
  it('403s when the caller has no household', async () => {
    const { status, error } = await call('POST', 'create', { name: 'X' }, { userId: 'u1', householdId: '' });
    expect(status).toBe(403);
    expect(error?.data?.code).toBe('FORBIDDEN');
  });

  it('401s when the authorizer set no userId', async () => {
    const { status } = await call('GET', 'list', undefined, { userId: '', householdId: '' });
    expect(status).toBe(401);
  });
});
