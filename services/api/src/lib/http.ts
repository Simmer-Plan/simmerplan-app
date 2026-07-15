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

// Small helpers for API Gateway HTTP API (payload v2) handlers.

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function parseBody<T>(event: APIGatewayProxyEventV2): T {
  if (!event.body) throw new HttpError(400, 'Missing request body');
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

/**
 * Context set by the Lambda authorizer. householdId is an empty string until
 * the user belongs to a household.
 */
export function authContext(event: APIGatewayProxyEventV2): {
  userId: string;
  householdId: string;
} {
  const lambdaCtx = (
    event.requestContext as unknown as {
      authorizer?: { lambda?: Record<string, unknown> };
    }
  ).authorizer?.lambda;
  const userId = typeof lambdaCtx?.userId === 'string' ? lambdaCtx.userId : '';
  const householdId = typeof lambdaCtx?.householdId === 'string' ? lambdaCtx.householdId : '';
  if (!userId) throw new HttpError(401, 'Unauthorized');
  return { userId, householdId };
}

export function routeKey(event: APIGatewayProxyEventV2): string {
  return `${event.requestContext.http.method} ${event.rawPath}`;
}

export function errorResponse(err: unknown): APIGatewayProxyResultV2 {
  if (err instanceof HttpError) return json(err.statusCode, { error: err.message });
  console.error('Unhandled error:', err);
  return json(500, { error: 'Internal server error' });
}
