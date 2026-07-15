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

function event(
  method: string,
  path: string,
  body: unknown,
  ctx: { userId: string; householdId: string },
): APIGatewayProxyEventV2 {
  return {
    rawPath: path,
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: {
      http: { method },
      authorizer: { lambda: ctx },
    },
  } as unknown as APIGatewayProxyEventV2;
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

describe('POST /household/create', () => {
  it('creates household, promotes user to owner, returns 201', async () => {
    ddb.on(PutCommand).resolves({});
    ddb.on(UpdateCommand).resolves({});
    const result = await handler(
      event(
        'POST',
        '/household/create',
        { name: 'LeBlanc Household' },
        { userId: 'u1', householdId: '' },
      ),
    );
    const response = JSON.parse((result as { body: string }).body);
    expect((result as { statusCode: number }).statusCode).toBe(201);
    expect(response.role).toBe('owner');
    expect(response.householdId).toMatch(/^[0-9a-f-]{36}$/);
    expect(cognito.commandCalls(AdminUpdateUserAttributesCommand)).toHaveLength(1);
  });

  it('409s when the caller already has a household', async () => {
    const result = await handler(
      event('POST', '/household/create', { name: 'X' }, { userId: 'u1', householdId: 'hh-1' }),
    );
    expect((result as { statusCode: number }).statusCode).toBe(409);
  });
});

describe('POST /household/join', () => {
  const claims = { tokenId: 't-1', householdId: 'hh-1', invitedBy: 'u-owner' };

  it('joins with a valid single-use token', async () => {
    ddb.on(UpdateCommand).resolves({});
    ddb.on(GetCommand).resolves({
      Item: { householdId: 'hh-1', name: 'LeBlanc Household', memberIds: ['u-owner'] },
    });
    const result = await handler(
      event(
        'POST',
        '/household/join',
        { token: inviteToken(claims) },
        { userId: 'u2', householdId: '' },
      ),
    );
    const response = JSON.parse((result as { body: string }).body);
    expect((result as { statusCode: number }).statusCode).toBe(200);
    expect(response).toMatchObject({
      householdId: 'hh-1',
      role: 'member',
      name: 'LeBlanc Household',
    });
  });

  it('409s when the invite was already used (conditional write fails)', async () => {
    const conditionErr = Object.assign(new Error('conditional failed'), {
      name: 'ConditionalCheckFailedException',
    });
    ddb.on(UpdateCommand).rejects(conditionErr);
    const result = await handler(
      event(
        'POST',
        '/household/join',
        { token: inviteToken(claims) },
        { userId: 'u3', householdId: '' },
      ),
    );
    expect((result as { statusCode: number }).statusCode).toBe(409);
  });

  it('401s on an expired invite token', async () => {
    const result = await handler(
      event(
        'POST',
        '/household/join',
        { token: inviteToken(claims, '-1h') },
        { userId: 'u2', householdId: '' },
      ),
    );
    expect((result as { statusCode: number }).statusCode).toBe(401);
  });

  it('401s on a token signed with the wrong key', async () => {
    const bad = jwt.sign(claims, 'wrong-key', { algorithm: 'HS256', expiresIn: '48h' });
    const result = await handler(
      event('POST', '/household/join', { token: bad }, { userId: 'u2', householdId: '' }),
    );
    expect((result as { statusCode: number }).statusCode).toBe(401);
  });
});

describe('POST /household/invite', () => {
  it('lets an owner mint a sandbox invite URL with a verifiable token', async () => {
    ddb.on(GetCommand).resolves({ Item: { userId: 'u1', role: 'owner' } });
    ddb.on(PutCommand).resolves({});
    const result = await handler(
      event('POST', '/household/invite', {}, { userId: 'u1', householdId: 'hh-1' }),
    );
    const response = JSON.parse((result as { body: string }).body);
    expect((result as { statusCode: number }).statusCode).toBe(201);
    expect(response.inviteUrl).toMatch(/^simmerplan:\/\/join\?token=/);
    const token = response.inviteUrl.split('token=')[1];
    const verified = jwt.verify(token, SIGNING_KEY) as Record<string, unknown>;
    expect(verified.householdId).toBe('hh-1');
    expect(verified.invitedBy).toBe('u1');
  });

  it('403s for non-owners', async () => {
    ddb.on(GetCommand).resolves({ Item: { userId: 'u2', role: 'member' } });
    const result = await handler(
      event('POST', '/household/invite', {}, { userId: 'u2', householdId: 'hh-1' }),
    );
    expect((result as { statusCode: number }).statusCode).toBe(403);
  });
});

describe('routing', () => {
  it('404s unknown routes', async () => {
    const result = await handler(
      event('DELETE', '/household/nope', undefined, { userId: 'u1', householdId: 'hh-1' }),
    );
    expect((result as { statusCode: number }).statusCode).toBe(404);
  });
});
