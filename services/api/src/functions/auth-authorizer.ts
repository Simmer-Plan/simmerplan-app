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

// Lambda authorizer (SIM-29). Verifies the Cognito JWT on every API Gateway
// request and returns an IAM policy with userId + householdId as context.
// Never throws — validation failures return a Deny policy.
//
// Clients send the Cognito *ID token* as the Bearer token: custom attributes
// (custom:householdId) are only present in ID tokens, and the authorizer's
// contract is to supply householdId without a DynamoDB lookup.

import type { APIGatewayRequestAuthorizerEventV2 } from 'aws-lambda';
import { jwksResolver, verifyJwt, type KeyResolver } from '../lib/jwt';

const REGION = process.env.AWS_REGION ?? 'ca-central-1';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? '';
const CLIENT_ID = process.env.COGNITO_CLIENT_ID ?? '';

const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;

// Module-level: created once per container, cached for 1 hour inside jwks-rsa.
const defaultResolver = () => jwksResolver(`${ISSUER}/.well-known/jwks.json`);

interface AuthorizerResult {
  principalId: string;
  policyDocument: {
    Version: '2012-10-17';
    Statement: Array<{ Action: 'execute-api:Invoke'; Effect: 'Allow' | 'Deny'; Resource: string }>;
  };
  context?: { userId: string; householdId: string };
}

function policy(
  effect: 'Allow' | 'Deny',
  resource: string,
  context?: { userId: string; householdId: string },
): AuthorizerResult {
  return {
    principalId: context?.userId ?? 'unauthorized',
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{ Action: 'execute-api:Invoke', Effect: effect, Resource: resource }],
    },
    ...(context ? { context } : {}),
  };
}

export function makeHandler(resolve?: KeyResolver) {
  return async (event: APIGatewayRequestAuthorizerEventV2): Promise<AuthorizerResult> => {
    const resource = event.routeArn ?? '*';
    try {
      const header = event.headers?.authorization ?? event.headers?.Authorization ?? '';
      const [scheme, token] = header.split(' ');
      if (scheme !== 'Bearer' || !token) return policy('Deny', resource);

      const claims = await verifyJwt(token, resolve ?? defaultResolver(), {
        issuer: ISSUER,
        audience: CLIENT_ID,
      });
      if (claims.token_use !== 'id' || typeof claims.sub !== 'string') {
        return policy('Deny', resource);
      }

      return policy('Allow', resource, {
        userId: claims.sub,
        householdId:
          typeof claims['custom:householdId'] === 'string'
            ? (claims['custom:householdId'] as string)
            : '',
      });
    } catch {
      return policy('Deny', resource);
    }
  };
}

export const handler = makeHandler();
