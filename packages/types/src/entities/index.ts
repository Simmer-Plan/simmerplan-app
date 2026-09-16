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

export type Role = 'owner' | 'member';

export interface UserRecord {
  userId: string;
  householdId: string | null;
  role: Role | null;
  googleId: string;
  email: string;
  name: string;
  photoUrl: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface HouseholdRecord {
  householdId: string;
  name: string;
  createdBy: string;
  /** Maintained on create/join so GET /household can list members without a GSI. */
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface InviteRecord {
  tokenId: string;
  householdId: string;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
  /** Unix seconds — DynamoDB TTL, expiry + 7 days. */
  TTL: number;
}

// --- Pantry (SIM-9) ---------------------------------------------------------

export type StorageLocationKind = 'cupboard' | 'fridge' | 'freezer' | 'pantry' | 'custom';

/** Units a pantry quantity can be expressed in. */
export type QuantityUnit =
  | 'count'
  | 'lb'
  | 'oz'
  | 'g'
  | 'kg'
  | 'ml'
  | 'l'
  | 'cup'
  | 'tbsp'
  | 'tsp';

export interface StorageLocationRecord {
  locationId: string;
  householdId: string;
  name: string;
  kind: StorageLocationKind;
  createdAt: string;
  updatedAt: string;
}

export interface PantryItemRecord {
  itemId: string;
  householdId: string;
  name: string;
  /** Storage location, or null if unassigned. */
  locationId: string | null;
  quantity: number;
  unit: QuantityUnit;
  /** ISO date (YYYY-MM-DD), or null when the item has no expiry. */
  expiryDate: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- Recipes (SIM-11) -------------------------------------------------------

export type RecipeComplexity = 'simple' | 'moderate' | 'complex';

export interface RecipeIngredient {
  name: string;
  quantity: number | null;
  unit: QuantityUnit | null;
  /** Optional link to a pantry item this ingredient corresponds to. */
  pantryItemId: string | null;
}

export interface RecipeRecord {
  recipeId: string;
  householdId: string;
  name: string;
  description: string;
  photoUrl: string | null;
  ingredients: RecipeIngredient[];
  /** Ordered step-by-step instructions. */
  instructions: string[];
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  complexity: RecipeComplexity;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
