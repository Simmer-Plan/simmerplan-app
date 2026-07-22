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

// Auth Lambda (SIM-29): serves the auth tRPC router over API Gateway HTTP API
// route POST /auth/{proxy+}. Unauthenticated — this is where tokens come from.
// The adapter maps /auth/<procedure> to the router procedure via pathParameters.

import { awsLambdaRequestHandler } from '@trpc/server/adapters/aws-lambda';
import { authRouter } from '../trpc/routers/auth';
import { createContext } from '../trpc/context';

export const handler = awsLambdaRequestHandler({
  router: authRouter,
  createContext,
});
