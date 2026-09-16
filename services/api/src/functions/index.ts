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

// Application Lambda (SIM-41) — simmerplan-api-<env>, handler `index.handler`.
// Serves every authorizer-gated domain router from the combined appRouter behind
// the existing gated catch-all route `ANY /{proxy+}`; procedures are namespaced
// (e.g. /pantry.listItems).
//
// The same function also backs the PUBLIC `GET /health` route. That route is not
// a {proxy+} route, so there is no `proxy` path parameter for tRPC to resolve a
// procedure from — health is answered directly here, before delegating, so the
// post-deploy health check never depends on tRPC path resolution.

import { awsLambdaRequestHandler } from '@trpc/server/adapters/aws-lambda';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, Context } from 'aws-lambda';
import { appRouter } from '../trpc/routers/app';
import { createContext } from '../trpc/context';

const trpcHandler = awsLambdaRequestHandler({
  router: appRouter,
  createContext,
});

function isHealthCheck(event: APIGatewayProxyEventV2): boolean {
  const path = event.rawPath ?? event.requestContext?.http?.path ?? '';
  return path === '/health' || path.endsWith('/health');
}

export const handler = async (
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyStructuredResultV2> => {
  if (isHealthCheck(event)) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'ok', deployed: 'app' }),
    };
  }
  return (await trpcHandler(event, context)) as APIGatewayProxyStructuredResultV2;
};
