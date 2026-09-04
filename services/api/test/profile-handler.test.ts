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

// Exercises the profile tRPC router through the deployed Lambda handler.

import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler } from '../src/functions/profile-handler';

const ddb = mockClient(DynamoDBDocumentClient);

type Ctx = { userId: string; householdId: string };

function trpcEvent(method: 'GET' | 'POST', procedure: string, input: unknown, ctx: Ctx): APIGatewayProxyEventV2 {
  const rawPath = `/profile/${procedure}`;
  const isQuery = method === 'GET';
  const rawQueryString =
    isQuery && input !== undefined ? `input=${encodeURIComponent(JSON.stringify(input))}` : '';
  return {
    version: '2.0',
    routeKey: `${method} /profile/{proxy+}`,
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

const CTX: Ctx = { userId: 'u1', householdId: 'hh-1' };
const USER = {
  userId: 'u1',
  householdId: 'hh-1',
  role: 'owner',
  email: 'a@example.com',
  name: 'Dave',
  photoUrl: '',
};

beforeEach(() => {
  ddb.reset();
});

describe('profile.get', () => {
  it('returns the profile with defaulted preferences', async () => {
    ddb.on(GetCommand).resolves({ Item: USER });
    const { status, data } = await call<{ email: string; preferences: { weeklyPlanReminder: boolean; expiryAlerts: boolean } }>(
      'GET',
      'get',
      undefined,
      CTX,
    );
    expect(status).toBe(200);
    expect(data.email).toBe('a@example.com');
    expect(data.preferences).toEqual({ weeklyPlanReminder: true, expiryAlerts: true });
  });

  it('merges stored preferences over the defaults', async () => {
    ddb.on(GetCommand).resolves({ Item: { ...USER, preferences: { weeklyPlanReminder: false, expiryAlerts: true } } });
    const { data } = await call<{ preferences: { weeklyPlanReminder: boolean } }>('GET', 'get', undefined, CTX);
    expect(data.preferences.weeklyPlanReminder).toBe(false);
  });

  it('404s when the user record is missing', async () => {
    ddb.on(GetCommand).resolves({});
    const { status, error } = await call('GET', 'get', undefined, CTX);
    expect(status).toBe(404);
    expect(error?.data?.code).toBe('NOT_FOUND');
  });
});

describe('profile.updateName / updatePreferences', () => {
  it('updates the display name', async () => {
    ddb.on(UpdateCommand).resolves({ Attributes: { ...USER, name: 'Dave L' } });
    const { status, data } = await call<{ name: string }>('POST', 'updateName', { name: 'Dave L' }, CTX);
    expect(status).toBe(200);
    expect(data.name).toBe('Dave L');
  });

  it('rejects a blank name', async () => {
    const { status } = await call('POST', 'updateName', { name: '   ' }, CTX);
    expect(status).toBe(400);
  });

  it('updates notification preferences', async () => {
    ddb.on(UpdateCommand).resolves({
      Attributes: { ...USER, preferences: { weeklyPlanReminder: false, expiryAlerts: false } },
    });
    const { status, data } = await call<{ preferences: { weeklyPlanReminder: boolean } }>(
      'POST',
      'updatePreferences',
      { weeklyPlanReminder: false, expiryAlerts: false },
      CTX,
    );
    expect(status).toBe(200);
    expect(data.preferences.weeklyPlanReminder).toBe(false);
  });
});

describe('profile dietary preferences (SIM-15)', () => {
  it('get returns defaulted dietary preferences', async () => {
    ddb.on(GetCommand).resolves({ Item: USER });
    const { data } = await call<{ dietary: { dietType: string; allergies: string[] } }>('GET', 'get', undefined, CTX);
    expect(data.dietary).toEqual({
      dietType: 'none',
      allergies: [],
      dislikedIngredients: [],
      cuisinePreferences: [],
    });
  });

  it('updates dietary preferences', async () => {
    ddb.on(UpdateCommand).resolves({
      Attributes: {
        ...USER,
        dietary: { dietType: 'vegetarian', allergies: ['peanuts'], dislikedIngredients: [], cuisinePreferences: ['thai'] },
      },
    });
    const { status, data } = await call<{ dietary: { dietType: string; allergies: string[]; cuisinePreferences: string[] } }>(
      'POST',
      'updateDietary',
      { dietType: 'vegetarian', allergies: ['peanuts'], cuisinePreferences: ['thai'] },
      CTX,
    );
    expect(status).toBe(200);
    expect(data.dietary.dietType).toBe('vegetarian');
    expect(data.dietary.allergies).toEqual(['peanuts']);
    expect(data.dietary.cuisinePreferences).toEqual(['thai']);
  });

  it('rejects a blank diet type', async () => {
    const { status } = await call('POST', 'updateDietary', { dietType: '' }, CTX);
    expect(status).toBe(400);
  });
});

describe('auth guard', () => {
  it('401s when the authorizer set no userId', async () => {
    const { status } = await call('GET', 'get', undefined, { userId: '', householdId: '' });
    expect(status).toBe(401);
  });
});
