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

// Entry-point behaviour for the consolidated application Lambda (SIM-41): the
// public GET /health route (which is NOT a {proxy+} route and therefore carries
// no procedure to resolve) and namespaced routing through the gated catch-all.

import { describe, expect, it } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler } from '../src/functions/index';

/** The real `GET /health` route: no proxy path parameter, no authorizer context. */
function healthEvent(): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'GET /health',
    rawPath: '/health',
    rawQueryString: '',
    headers: {},
    isBase64Encoded: false,
    requestContext: { domainName: 'api.test', http: { method: 'GET', path: '/health' } },
  } as unknown as APIGatewayProxyEventV2;
}

/** A gated catch-all request, e.g. GET /pantry.listItems. */
function proxyEvent(procedure: string): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'GET /{proxy+}',
    rawPath: `/${procedure}`,
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    pathParameters: { proxy: procedure },
    isBase64Encoded: false,
    requestContext: {
      domainName: 'api.test',
      http: { method: 'GET', path: `/${procedure}` },
      authorizer: { lambda: { userId: '', householdId: '' } },
    },
  } as unknown as APIGatewayProxyEventV2;
}

describe('GET /health', () => {
  it('answers 200 without touching tRPC (no procedure to resolve)', async () => {
    const res = (await handler(healthEvent(), {} as never)) as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ status: 'ok', deployed: 'app' });
  });
});

describe('gated catch-all routing', () => {
  it('resolves namespaced procedures through the combined router', async () => {
    // No userId in the authorizer context -> the protected procedure rejects,
    // which proves the procedure resolved rather than 404ing.
    const res = (await handler(proxyEvent('pantry.listItems'), {} as never)) as {
      statusCode: number;
    };
    expect(res.statusCode).toBe(401);
  });

  it('404s an unknown namespaced procedure', async () => {
    const res = (await handler(proxyEvent('pantry.nope'), {} as never)) as { statusCode: number };
    expect(res.statusCode).toBe(404);
  });
});
