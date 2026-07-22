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

import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';
import type { APIGatewayRequestAuthorizerEventV2 } from 'aws-lambda';
import { makeHandler } from '../src/functions/auth-authorizer';

const REGION = process.env.AWS_REGION ?? 'ca-central-1';
const POOL = process.env.COGNITO_USER_POOL_ID ?? '';
const CLIENT = process.env.COGNITO_CLIENT_ID ?? '';
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${POOL}`;

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const resolve = async () => pem;

function sign(claims: Record<string, unknown>, opts: jwt.SignOptions = {}): string {
  return jwt.sign(claims, privateKey, {
    algorithm: 'RS256',
    issuer: ISSUER,
    audience: CLIENT,
    expiresIn: '1h',
    keyid: 'test-key',
    ...opts,
  });
}

function event(authHeader?: string): APIGatewayRequestAuthorizerEventV2 {
  return {
    routeArn: 'arn:aws:execute-api:ca-central-1:123:api/$default/GET/household',
    headers: authHeader ? { authorization: authHeader } : {},
  } as unknown as APIGatewayRequestAuthorizerEventV2;
}

describe('auth-authorizer', () => {
  it('allows a valid ID token and passes userId + householdId context', async () => {
    const token = sign({ sub: 'user-123', token_use: 'id', 'custom:householdId': 'hh-9' });
    const result = await makeHandler(resolve)(event(`Bearer ${token}`));
    expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(result.context).toEqual({ userId: 'user-123', householdId: 'hh-9' });
  });

  it('passes empty householdId for users not yet in a household', async () => {
    const token = sign({ sub: 'user-123', token_use: 'id' });
    const result = await makeHandler(resolve)(event(`Bearer ${token}`));
    expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(result.context?.householdId).toBe('');
  });

  it('denies an expired token without throwing', async () => {
    const token = sign({ sub: 'user-123', token_use: 'id' }, { expiresIn: '-10s' });
    const result = await makeHandler(resolve)(event(`Bearer ${token}`));
    expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
    expect(result.context).toBeUndefined();
  });

  it('denies access tokens (custom claims only exist on ID tokens)', async () => {
    const token = sign({ sub: 'user-123', token_use: 'access' });
    const result = await makeHandler(resolve)(event(`Bearer ${token}`));
    expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
  });

  it('denies a missing or malformed Authorization header', async () => {
    expect((await makeHandler(resolve)(event())).policyDocument.Statement[0].Effect).toBe('Deny');
    expect(
      (await makeHandler(resolve)(event('Basic abc'))).policyDocument.Statement[0].Effect,
    ).toBe('Deny');
    expect(
      (await makeHandler(resolve)(event('Bearer not-a-jwt'))).policyDocument.Statement[0].Effect,
    ).toBe('Deny');
  });

  it('denies a token signed by a different key', async () => {
    const { privateKey: otherKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const token = jwt.sign({ sub: 'user-123', token_use: 'id' }, otherKey, {
      algorithm: 'RS256',
      issuer: ISSUER,
      audience: CLIENT,
      expiresIn: '1h',
    });
    const result = await makeHandler(resolve)(event(`Bearer ${token}`));
    expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
  });
});
