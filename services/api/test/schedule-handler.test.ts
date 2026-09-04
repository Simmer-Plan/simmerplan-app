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

// Exercises the schedule tRPC router through the deployed Lambda handler.

import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler } from '../src/functions/schedule-handler';

const ddb = mockClient(DynamoDBDocumentClient);

type Ctx = { userId: string; householdId: string };

function trpcEvent(method: 'GET' | 'POST', procedure: string, input: unknown, ctx: Ctx): APIGatewayProxyEventV2 {
  const rawPath = `/schedule/${procedure}`;
  const isQuery = method === 'GET';
  const rawQueryString =
    isQuery && input !== undefined ? `input=${encodeURIComponent(JSON.stringify(input))}` : '';
  return {
    version: '2.0',
    routeKey: `${method} /schedule/{proxy+}`,
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

const CTX: Ctx = { userId: 'u1', householdId: 'hh-1' };

beforeEach(() => {
  ddb.reset();
});

describe('schedule.get', () => {
  it('returns an empty schedule when none exists', async () => {
    ddb.on(GetCommand).resolves({});
    const { status, data } = await call<{ days: Record<string, unknown> }>('GET', 'get', undefined, CTX);
    expect(status).toBe(200);
    expect(data.days).toEqual({});
  });

  it('returns stored days', async () => {
    ddb.on(GetCommand).resolves({ Item: { userId: 'u1', days: { tue: { busyness: 'busy', label: 'soccer' } } } });
    const { data } = await call<{ days: Record<string, { busyness: string }> }>('GET', 'get', undefined, CTX);
    expect(data.days.tue.busyness).toBe('busy');
  });
});

describe('schedule.setDay', () => {
  it('sets a day and returns the updated map', async () => {
    ddb.on(UpdateCommand).resolvesOnce({}).resolves({
      Attributes: { userId: 'u1', days: { mon: { busyness: 'free', label: '' } } },
    });
    const { status, data } = await call<{ days: Record<string, { busyness: string }> }>(
      'POST',
      'setDay',
      { day: 'mon', busyness: 'free' },
      CTX,
    );
    expect(status).toBe(200);
    expect(data.days.mon.busyness).toBe('free');
  });

  it('rejects an invalid day or busyness', async () => {
    expect((await call('POST', 'setDay', { day: 'funday', busyness: 'free' }, CTX)).status).toBe(400);
    expect((await call('POST', 'setDay', { day: 'mon', busyness: 'chaotic' }, CTX)).status).toBe(400);
  });
});

describe('auth guard', () => {
  it('401s without a userId', async () => {
    const { status } = await call('GET', 'get', undefined, { userId: '', householdId: '' });
    expect(status).toBe(401);
  });
});
