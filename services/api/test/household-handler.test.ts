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

// Exercises the household tRPC router through the deployed Lambda handler,
// driving it with API Gateway HTTP API (payload v2) events shaped exactly like
// the tRPC httpLink produces (/household/<procedure>, proxy path param).

import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import jwt from 'jsonwebtoken';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler } from '../src/functions/household-handler';

const SIGNING_KEY = 'test-invite-signing-key';
const ddb = mockClient(DynamoDBDocumentClient);
const cognito = mockClient(CognitoIdentityProviderClient);
const secrets = mockClient(SecretsManagerClient);

type Ctx = { userId: string; householdId: string };

/** Build the API Gateway v2 event a tRPC httpLink call to /household/<proc> produces. */
function trpcEvent(
  method: 'GET' | 'POST',
  procedure: string,
  input: unknown,
  ctx: Ctx,
): APIGatewayProxyEventV2 {
  const rawPath = `/household/${procedure}`;
  const isQuery = method === 'GET';
  const rawQueryString =
    isQuery && input !== undefined ? `input=${encodeURIComponent(JSON.stringify(input))}` : '';
  return {
    version: '2.0',
    routeKey: `${method} /household/{proxy+}`,
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

/** Invoke the handler and unwrap the tRPC envelope into { status, data, error }. */
async function call<T = unknown>(
  method: 'GET' | 'POST',
  procedure: string,
  input: unknown,
  ctx: Ctx,
): Promise<{ status: number; data: T; error?: TrpcError }> {
  const result = (await handler(
    trpcEvent(method, procedure, input, ctx),
    {} as never,
  )) as { statusCode: number; body: string };
  const parsed = JSON.parse(result.body) as { result?: { data: T }; error?: TrpcError };
  return { status: result.statusCode, data: parsed.result?.data as T, error: parsed.error };
}

function inviteToken(claims: Record<string, unknown>, expiresIn = '48h'): string {
  return jwt.sign(claims, SIGNING_KEY, { algorithm: 'HS256', expiresIn });
}

beforeEach(() => {
  ddb.reset();
  cognito.reset();
  secrets.reset();
  secrets.on(GetSecretValueCommand).resolves({ SecretString: SIGNING_KEY });
  cognito.on(AdminUpdateUserAttributesCommand).resolves({});
  cognito.on(InitiateAuthCommand).resolves({
    AuthenticationResult: { AccessToken: 'a', IdToken: 'i' },
  });
});

describe('household.create', () => {
  it('creates household, promotes user to owner', async () => {
    ddb.on(PutCommand).resolves({});
    ddb.on(UpdateCommand).resolves({});
    const { status, data } = await call<{ role: string; householdId: string }>(
      'POST',
      'create',
      { name: 'LeBlanc Household' },
      { userId: 'u1', householdId: '' },
    );
    expect(status).toBe(200);
    expect(data.role).toBe('owner');
    expect(data.householdId).toMatch(/^[0-9a-f-]{36}$/);
    expect(cognito.commandCalls(AdminUpdateUserAttributesCommand)).toHaveLength(1);
  });

  it('409s (CONFLICT) when the caller already has a household', async () => {
    const { status, error } = await call('POST', 'create', { name: 'X' }, {
      userId: 'u1',
      householdId: 'hh-1',
    });
    expect(status).toBe(409);
    expect(error?.data?.code).toBe('CONFLICT');
  });
});

describe('household.join', () => {
  const claims = { tokenId: 't-1', householdId: 'hh-1', invitedBy: 'u-owner' };

  it('joins with a valid single-use token', async () => {
    ddb.on(UpdateCommand).resolves({});
    ddb.on(GetCommand).resolves({
      Item: { householdId: 'hh-1', name: 'LeBlanc Household', memberIds: ['u-owner'] },
    });
    const { status, data } = await call(
      'POST',
      'join',
      { token: inviteToken(claims) },
      { userId: 'u2', householdId: '' },
    );
    expect(status).toBe(200);
    expect(data).toMatchObject({ householdId: 'hh-1', role: 'member', name: 'LeBlanc Household' });
    // data is unknown here; toMatchObject validates the shape structurally.
  });

  it('409s when the invite was already used (conditional write fails)', async () => {
    const conditionErr = Object.assign(new Error('conditional failed'), {
      name: 'ConditionalCheckFailedException',
    });
    ddb.on(UpdateCommand).rejects(conditionErr);
    const { status } = await call(
      'POST',
      'join',
      { token: inviteToken(claims) },
      { userId: 'u3', householdId: '' },
    );
    expect(status).toBe(409);
  });

  it('401s on an expired invite token', async () => {
    const { status } = await call(
      'POST',
      'join',
      { token: inviteToken(claims, '-1h') },
      { userId: 'u2', householdId: '' },
    );
    expect(status).toBe(401);
  });

  it('401s on a token signed with the wrong key', async () => {
    const bad = jwt.sign(claims, 'wrong-key', { algorithm: 'HS256', expiresIn: '48h' });
    const { status } = await call('POST', 'join', { token: bad }, {
      userId: 'u2',
      householdId: '',
    });
    expect(status).toBe(401);
  });
});

describe('household.invite', () => {
  it('lets an owner mint a sandbox invite URL with a verifiable token', async () => {
    ddb.on(GetCommand).resolves({ Item: { userId: 'u1', role: 'owner' } });
    ddb.on(PutCommand).resolves({});
    const { status, data } = await call<{ inviteUrl: string }>('POST', 'invite', undefined, {
      userId: 'u1',
      householdId: 'hh-1',
    });
    expect(status).toBe(200);
    expect(data.inviteUrl).toMatch(/^simmerplan:\/\/join\?token=/);
    const token = data.inviteUrl.split('token=')[1];
    const verified = jwt.verify(token, SIGNING_KEY) as Record<string, unknown>;
    expect(verified.householdId).toBe('hh-1');
    expect(verified.invitedBy).toBe('u1');
  });

  it('403s for non-owners', async () => {
    ddb.on(GetCommand).resolves({ Item: { userId: 'u2', role: 'member' } });
    const { status, error } = await call('POST', 'invite', undefined, {
      userId: 'u2',
      householdId: 'hh-1',
    });
    expect(status).toBe(403);
    expect(error?.data?.code).toBe('FORBIDDEN');
  });
});

describe('routing / auth', () => {
  it('401s (UNAUTHORIZED) when the authorizer set no userId', async () => {
    const { status } = await call('POST', 'invite', undefined, { userId: '', householdId: '' });
    expect(status).toBe(401);
  });

  it('404s an unknown procedure', async () => {
    const { status } = await call('POST', 'nope', {}, { userId: 'u1', householdId: 'hh-1' });
    expect(status).toBe(404);
  });
});
