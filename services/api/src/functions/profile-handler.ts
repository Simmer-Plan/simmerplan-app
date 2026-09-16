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

// Profile Lambda (SIM-21): serves the profile tRPC router over API Gateway HTTP
// API route /profile/{proxy+}, behind the Lambda authorizer.

import { awsLambdaRequestHandler } from '@trpc/server/adapters/aws-lambda';
import { profileRouter } from '../trpc/routers/profile';
import { createContext } from '../trpc/context';

export const handler = awsLambdaRequestHandler({
  router: profileRouter,
  createContext,
});
