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

// Exercises the pantry tRPC router through the deployed Lambda handler, driving
// it with API Gateway HTTP API (payload v2) events shaped like the tRPC
// httpLink produces (/pantry/<procedure>, proxy path param).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler } from '../src/functions/pantry-handler';

const ddb = mockClient(DynamoDBDocumentClient);

type Ctx = { userId: string; householdId: string };

function trpcEvent(
  method: 'GET' | 'POST',
  procedure: string,
  input: unknown,
  ctx: Ctx,
): APIGatewayProxyEventV2 {
  const rawPath = `/pantry/${procedure}`;
  const isQuery = method === 'GET';
  const rawQueryString =
    isQuery && input !== undefined ? `input=${encodeURIComponent(JSON.stringify(input))}` : '';
  return {
    version: '2.0',
    routeKey: `${method} /pantry/{proxy+}`,
    rawPath,
    rawQueryString,
    headers: { 'content-type': 'application/json' },
    pathParameters: { proxy: procedure },
    isBase64Encoded: false,
    body: !isQuery && input !== undefined ? JSON.stringify(input) : undefined,
    requestContext: {
      domainName: 'api.test',
      http: { method, path: rawPath },
      authorizer: { lambda: ctx },
    },
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

describe('pantry locations', () => {
  it('creates a storage location', async () => {
    ddb.on(PutCommand).resolves({});
    const { status, data } = await call<{ locationId: string; name: string; kind: string }>(
      'POST',
      'createLocation',
      { name: 'Fridge', kind: 'fridge' },
      WITH_HH,
    );
    expect(status).toBe(200);
    expect(data.name).toBe('Fridge');
    expect(data.kind).toBe('fridge');
    expect(data.locationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('lists storage locations', async () => {
    ddb.on(QueryCommand).resolves({
      Items: [{ locationId: 'l1', householdId: 'hh-1', name: 'Fridge', kind: 'fridge' }],
    });
    const { status, data } = await call<{ name: string }[]>('GET', 'listLocations', undefined, WITH_HH);
    expect(status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe('Fridge');
  });

  it('rejects an invalid location kind', async () => {
    const { status } = await call('POST', 'createLocation', { name: 'X', kind: 'garage' }, WITH_HH);
    expect(status).toBe(400);
  });
});

describe('pantry items', () => {
  it('creates an item with defaults', async () => {
    ddb.on(PutCommand).resolves({});
    const { status, data } = await call<{ itemId: string; unit: string; quantity: number }>(
      'POST',
      'createItem',
      { name: 'Rice' },
      WITH_HH,
    );
    expect(status).toBe(200);
    expect(data.unit).toBe('count');
    expect(data.quantity).toBe(1);
    expect(data.itemId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects a malformed expiry date', async () => {
    const { status } = await call('POST', 'createItem', { name: 'Milk', expiryDate: '01/02/2026' }, WITH_HH);
    expect(status).toBe(400);
  });

  it('lists items and filters by location + search in memory', async () => {
    ddb.on(QueryCommand).resolves({
      Items: [
        { itemId: 'i1', householdId: 'hh-1', name: 'Rice', locationId: 'l1', quantity: 2, unit: 'lb', expiryDate: null },
        { itemId: 'i2', householdId: 'hh-1', name: 'Beans', locationId: 'l2', quantity: 1, unit: 'count', expiryDate: null },
      ],
    });
    const byLoc = await call<{ name: string }[]>('GET', 'listItems', { locationId: 'l1' }, WITH_HH);
    expect(byLoc.data.map((i) => i.name)).toEqual(['Rice']);

    ddb.on(QueryCommand).resolves({
      Items: [
        { itemId: 'i1', householdId: 'hh-1', name: 'Rice', locationId: 'l1', quantity: 2, unit: 'lb', expiryDate: null },
        { itemId: 'i2', householdId: 'hh-1', name: 'Beans', locationId: 'l2', quantity: 1, unit: 'count', expiryDate: null },
      ],
    });
    const bySearch = await call<{ name: string }[]>('GET', 'listItems', { search: 'bea' }, WITH_HH);
    expect(bySearch.data.map((i) => i.name)).toEqual(['Beans']);
  });

  it('updates an item and returns the new attributes', async () => {
    ddb.on(UpdateCommand).resolves({
      Attributes: { itemId: 'i1', householdId: 'hh-1', name: 'Rice', locationId: 'l1', quantity: 5, unit: 'lb', expiryDate: null },
    });
    const { status, data } = await call<{ quantity: number }>(
      'POST',
      'updateItem',
      { itemId: 'i1', quantity: 5 },
      WITH_HH,
    );
    expect(status).toBe(200);
    expect(data.quantity).toBe(5);
  });

  it('404s updating a missing item (conditional check fails)', async () => {
    ddb.on(UpdateCommand).rejects(
      Object.assign(new Error('conditional failed'), { name: 'ConditionalCheckFailedException' }),
    );
    const { status, error } = await call('POST', 'updateItem', { itemId: 'nope', quantity: 1 }, WITH_HH);
    expect(status).toBe(404);
    expect(error?.data?.code).toBe('NOT_FOUND');
  });

  it('deletes an item', async () => {
    ddb.on(DeleteCommand).resolves({});
    const { status, data } = await call<{ itemId: string }>('POST', 'deleteItem', { itemId: 'i1' }, WITH_HH);
    expect(status).toBe(200);
    expect(data.itemId).toBe('i1');
  });
});

describe('pantry.lookupBarcode (SIM-10)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns product details for a known barcode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: 1, product: { product_name: 'Frozen Peas', brands: 'Green', categories: 'Frozen vegetables' } }),
      })),
    );
    const { status, data } = await call<{ found: boolean; name: string; suggestedLocationKind: string }>(
      'GET',
      'lookupBarcode',
      { barcode: '0123456789012' },
      WITH_HH,
    );
    expect(status).toBe(200);
    expect(data.found).toBe(true);
    expect(data.name).toBe('Frozen Peas');
    expect(data.suggestedLocationKind).toBe('freezer');
  });

  it('returns found=false on a 404 from the product API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    const { status, data } = await call<{ found: boolean }>('GET', 'lookupBarcode', { barcode: '000000000000' }, WITH_HH);
    expect(status).toBe(200);
    expect(data.found).toBe(false);
  });

  it('rejects a non-numeric barcode', async () => {
    const { status } = await call('GET', 'lookupBarcode', { barcode: 'abc' }, WITH_HH);
    expect(status).toBe(400);
  });
});

describe('auth guards', () => {
  it('403s when the caller has no household', async () => {
    const { status, error } = await call('POST', 'createItem', { name: 'X' }, { userId: 'u1', householdId: '' });
    expect(status).toBe(403);
    expect(error?.data?.code).toBe('FORBIDDEN');
  });

  it('401s when the authorizer set no userId', async () => {
    const { status } = await call('GET', 'listItems', undefined, { userId: '', householdId: '' });
    expect(status).toBe(401);
  });
});
