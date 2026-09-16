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

// Combined application router (SIM-41). Every authorizer-gated domain router is
// mounted here and served by a single Lambda (simmerplan-api-<env>) behind the
// existing gated catch-all route `ANY /{proxy+}`. Procedures are addressed
// namespaced, e.g. `pantry.listItems` -> POST/GET /pantry.listItems.
//
// Auth (/auth, public) and household (/household, gated) keep their own
// Lambdas and routes and are deliberately NOT mounted here.

import { router } from '../trpc';
import { groceryRouter } from './grocery';
import { mealplanRouter } from './mealplan';
import { pantryRouter } from './pantry';
import { profileRouter } from './profile';
import { recipeRouter } from './recipe';
import { scheduleRouter } from './schedule';

export const appRouter = router({
  pantry: pantryRouter,
  recipes: recipeRouter,
  mealplans: mealplanRouter,
  profile: profileRouter,
  grocery: groceryRouter,
  schedule: scheduleRouter,
});

export type AppRouter = typeof appRouter;
