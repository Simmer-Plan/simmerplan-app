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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('recipe.search (pantry availability, SIM-13)', () => {
  const recipes = [
    {
      recipeId: 'r1',
      householdId: 'hh-1',
      name: 'Bean Chili',
      description: '',
      complexity: 'simple',
      tags: ['vegetarian'],
      instructions: [],
      prepTimeMinutes: 5,
      cookTimeMinutes: 20,
      favourite: false,
      lastUsedAt: null,
      ingredients: [
        { name: 'Beans', quantity: 1, unit: 'cup', pantryItemId: 'p1' },
        { name: 'Onion', quantity: 1, unit: 'count', pantryItemId: null },
      ],
    },
    {
      recipeId: 'r2',
      householdId: 'hh-1',
      name: 'Plain Rice',
      description: '',
      complexity: 'simple',
      tags: [],
      instructions: [],
      prepTimeMinutes: 1,
      cookTimeMinutes: 15,
      favourite: true,
      lastUsedAt: '2026-02-01T00:00:00.000Z',
      ingredients: [{ name: 'Rice', quantity: 1, unit: 'cup', pantryItemId: 'p2' }],
    },
  ];
  const pantry = [
    { itemId: 'p2', householdId: 'hh-1', name: 'Rice' },
    { itemId: 'p3', householdId: 'hh-1', name: 'Onion' },
  ];

  beforeEach(() => {
    ddb
      .on(QueryCommand, { ExpressionAttributeValues: { ':pk': 'HOUSEHOLD#hh-1#RECIPES' } })
      .resolves({ Items: recipes });
    ddb
      .on(QueryCommand, { ExpressionAttributeValues: { ':pk': 'HOUSEHOLD#hh-1#PANTRY' } })
      .resolves({ Items: pantry });
  });

  it('annotates recipes with pantry availability (link by id or name)', async () => {
    const { status, data } = await call<
      { recipeId: string; availability: { availableCount: number; totalCount: number; makeable: boolean } }[]
    >('GET', 'search', undefined, WITH_HH);
    expect(status).toBe(200);
    const byId = Object.fromEntries(data.map((r) => [r.recipeId, r.availability]));
    // Bean Chili: Onion matches by name, Beans (p1) not in pantry → 1/2, not makeable.
    expect(byId.r1).toMatchObject({ availableCount: 1, totalCount: 2, makeable: false });
    // Plain Rice: Rice matches by id p2 → 1/1, makeable.
    expect(byId.r2).toMatchObject({ availableCount: 1, totalCount: 1, makeable: true });
  });

  it('makeableOnly returns just the fully-stocked recipes', async () => {
    const { data } = await call<{ recipeId: string }[]>('GET', 'search', { makeableOnly: true }, WITH_HH);
    expect(data.map((r) => r.recipeId)).toEqual(['r2']);
  });

  it('favouritesOnly filters to favourites', async () => {
    const { data } = await call<{ recipeId: string }[]>('GET', 'search', { favouritesOnly: true }, WITH_HH);
    expect(data.map((r) => r.recipeId)).toEqual(['r2']);
  });

  it('maxTotalMinutes filters by prep + cook time', async () => {
    const { data } = await call<{ recipeId: string }[]>('GET', 'search', { maxTotalMinutes: 16 }, WITH_HH);
    expect(data.map((r) => r.recipeId)).toEqual(['r2']); // Rice 16 min; Chili 25 min excluded
  });
});

describe('recipe.importFromUrl (SIM-12)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const recipePage = (jsonLd: unknown) =>
    `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head></html>`;

  it('parses a URL and maps ingredients onto pantry items', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          recipePage({
            '@type': 'Recipe',
            name: 'Imported Soup',
            recipeIngredient: ['2 cups Rice', '1 tomato'],
            recipeInstructions: 'Boil',
          }),
      })),
    );
    ddb
      .on(QueryCommand, { ExpressionAttributeValues: { ':pk': 'HOUSEHOLD#hh-1#PANTRY' } })
      .resolves({ Items: [{ itemId: 'p2', householdId: 'hh-1', name: 'Rice' }] });

    const { status, data } = await call<{
      name: string;
      ingredients: { name: string; pantryItemId: string | null }[];
    }>('POST', 'importFromUrl', { url: 'https://example.com/soup' }, WITH_HH);

    expect(status).toBe(200);
    expect(data.name).toBe('Imported Soup');
    // "2 cups Rice" links to pantry Rice; "1 tomato" stays unlinked.
    expect(data.ingredients.find((i) => i.name.includes('Rice'))?.pantryItemId).toBe('p2');
    expect(data.ingredients.find((i) => i.name.includes('tomato'))?.pantryItemId).toBeNull();
  });

  it('400s when the page has no recipe data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, text: async () => '<html><body>no recipe</body></html>' })),
    );
    ddb.on(QueryCommand).resolves({ Items: [] });
    const { status, error } = await call('POST', 'importFromUrl', { url: 'https://example.com/x' }, WITH_HH);
    expect(status).toBe(400);
    expect(error?.data?.code).toBe('BAD_REQUEST');
  });

  it('400s when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, text: async () => '' })));
    const { status } = await call('POST', 'importFromUrl', { url: 'https://example.com/missing' }, WITH_HH);
    expect(status).toBe(400);
  });
});

describe('recipe.setFavourite / markUsed', () => {
  it('sets the favourite flag', async () => {
    ddb.on(UpdateCommand).resolves({});
    const { status, data } = await call<{ favourite: boolean }>(
      'POST',
      'setFavourite',
      { recipeId: 'r1', favourite: true },
      WITH_HH,
    );
    expect(status).toBe(200);
    expect(data.favourite).toBe(true);
  });

  it('404s setFavourite for a missing recipe', async () => {
    ddb.on(UpdateCommand).rejects(
      Object.assign(new Error('conditional failed'), { name: 'ConditionalCheckFailedException' }),
    );
    const { status } = await call('POST', 'setFavourite', { recipeId: 'nope', favourite: true }, WITH_HH);
    expect(status).toBe(404);
  });

  it('records lastUsedAt on markUsed', async () => {
    ddb.on(UpdateCommand).resolves({});
    const { status, data } = await call<{ lastUsedAt: string }>('POST', 'markUsed', { recipeId: 'r1' }, WITH_HH);
    expect(status).toBe(200);
    expect(data.lastUsedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
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
