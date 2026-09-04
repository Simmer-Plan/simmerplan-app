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

// Router type surface consumed by the mobile tRPC client (SIM-29). Type-only —
// no server code is bundled into the app. The two routers are deployed as
// separate Lambdas behind separate API Gateway routes (public /auth vs.
// authorizer-gated /household), so the client uses one link per router.

export type { AuthRouter } from './trpc/routers/auth';
export type { HouseholdRouter } from './trpc/routers/household';
export type { PantryRouter } from './trpc/routers/pantry';
export type { RecipeRouter } from './trpc/routers/recipe';
export type { ProfileRouter } from './trpc/routers/profile';
export type { MealplanRouter } from './trpc/routers/mealplan';
export type { GroceryRouter } from './trpc/routers/grocery';
