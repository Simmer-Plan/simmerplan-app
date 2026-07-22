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

// tRPC request context (SIM-29). userId/householdId come from the API Gateway
// Lambda authorizer context — never from the request body. Public routes
// (/auth/*) run without the authorizer, so both fields are empty there.

import type { CreateAWSLambdaContextOptions } from '@trpc/server/adapters/aws-lambda';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

export function createContext({ event }: CreateAWSLambdaContextOptions<APIGatewayProxyEventV2>) {
  const lambdaCtx = (
    event.requestContext as unknown as {
      authorizer?: { lambda?: Record<string, unknown> };
    }
  ).authorizer?.lambda;
  const userId = typeof lambdaCtx?.userId === 'string' ? lambdaCtx.userId : '';
  const householdId = typeof lambdaCtx?.householdId === 'string' ? lambdaCtx.householdId : '';
  return { userId, householdId };
}

export type Context = ReturnType<typeof createContext>;
