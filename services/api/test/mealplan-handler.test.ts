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

// Exercises the mealplan tRPC router through the deployed Lambda handler.

import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler } from '../src/functions/mealplan-handler';

const ddb = mockClient(DynamoDBDocumentClient);

type Ctx = { userId: string; householdId: string };

function trpcEvent(method: 'GET' | 'POST', procedure: string, input: unknown, ctx: Ctx): APIGatewayProxyEventV2 {
  const rawPath = `/mealplans/${procedure}`;
  const isQuery = method === 'GET';
  const rawQueryString =
    isQuery && input !== undefined ? `input=${encodeURIComponent(JSON.stringify(input))}` : '';
  return {
    version: '2.0',
    routeKey: `${method} /mealplans/{proxy+}`,
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
const WEEK = '2026-09-07';

beforeEach(() => {
  ddb.reset();
});

describe('mealplan.getWeek', () => {
  it('returns an empty week when none exists', async () => {
    ddb.on(GetCommand).resolves({});
    const { status, data } = await call<{ weekStartDate: string; slots: Record<string, unknown> }>(
      'GET',
      'getWeek',
      { weekStartDate: WEEK },
      WITH_HH,
    );
    expect(status).toBe(200);
    expect(data.weekStartDate).toBe(WEEK);
    expect(data.slots).toEqual({});
  });

  it('rejects a malformed week date', async () => {
    const { status } = await call('GET', 'getWeek', { weekStartDate: '09-07-2026' }, WITH_HH);
    expect(status).toBe(400);
  });
});

describe('mealplan.setSlot / clearSlot', () => {
  it('sets a slot on a new week', async () => {
    ddb.on(GetCommand).resolves({});
    ddb.on(PutCommand).resolves({});
    const { status, data } = await call<{ slots: Record<string, { recipeName: string }> }>(
      'POST',
      'setSlot',
      { weekStartDate: WEEK, day: 'mon', mealType: 'dinner', recipeId: 'r1', recipeName: 'Chili' },
      WITH_HH,
    );
    expect(status).toBe(200);
    expect(data.slots['mon:dinner']).toMatchObject({ recipeId: 'r1', recipeName: 'Chili' });
  });

  it('merges into existing slots', async () => {
    ddb.on(GetCommand).resolves({
      Item: { householdId: 'hh-1', weekStartDate: WEEK, slots: { 'tue:lunch': { recipeId: 'r2', recipeName: 'Soup', note: '' } }, createdAt: 'x' },
    });
    ddb.on(PutCommand).resolves({});
    const { data } = await call<{ slots: Record<string, unknown> }>(
      'POST',
      'setSlot',
      { weekStartDate: WEEK, day: 'mon', mealType: 'dinner', recipeId: 'r1', recipeName: 'Chili' },
      WITH_HH,
    );
    expect(Object.keys(data.slots).sort()).toEqual(['mon:dinner', 'tue:lunch']);
  });

  it('rejects an invalid day or meal type', async () => {
    const badDay = await call('POST', 'setSlot', { weekStartDate: WEEK, day: 'funday', mealType: 'dinner' }, WITH_HH);
    expect(badDay.status).toBe(400);
    const badMeal = await call('POST', 'setSlot', { weekStartDate: WEEK, day: 'mon', mealType: 'brunch' }, WITH_HH);
    expect(badMeal.status).toBe(400);
  });

  it('clears a slot', async () => {
    ddb.on(GetCommand).resolves({
      Item: { householdId: 'hh-1', weekStartDate: WEEK, slots: { 'mon:dinner': { recipeId: 'r1', recipeName: 'Chili', note: '' } }, createdAt: 'x' },
    });
    ddb.on(PutCommand).resolves({});
    const { data } = await call<{ slots: Record<string, unknown> }>(
      'POST',
      'clearSlot',
      { weekStartDate: WEEK, day: 'mon', mealType: 'dinner' },
      WITH_HH,
    );
    expect(data.slots['mon:dinner']).toBeUndefined();
  });
});

describe('auth guards', () => {
  it('403s when the caller has no household', async () => {
    const { status } = await call('GET', 'getWeek', { weekStartDate: WEEK }, { userId: 'u1', householdId: '' });
    expect(status).toBe(403);
  });

  it('401s when the authorizer set no userId', async () => {
    const { status } = await call('GET', 'getWeek', { weekStartDate: WEEK }, { userId: '', householdId: '' });
    expect(status).toBe(401);
  });
});
