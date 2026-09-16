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

/** Notification preferences (SIM-21). Delivery wiring is Phase 4 (FCM). */
export interface UserPreferences {
  weeklyPlanReminder: boolean;
  expiryAlerts: boolean;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  weeklyPlanReminder: true,
  expiryAlerts: true,
};

/** Dietary preferences/restrictions that inform AI suggestions (SIM-15). */
export interface DietaryPreferences {
  /** e.g. none|vegetarian|vegan|pescatarian|keto|paleo|halal|kosher, or custom. */
  dietType: string;
  allergies: string[];
  dislikedIngredients: string[];
  cuisinePreferences: string[];
}

export const DEFAULT_DIETARY_PREFERENCES: DietaryPreferences = {
  dietType: 'none',
  allergies: [],
  dislikedIngredients: [],
  cuisinePreferences: [],
};

export interface UserRecord {
  userId: string;
  householdId: string | null;
  role: Role | null;
  googleId: string;
  email: string;
  name: string;
  photoUrl: string;
  /** Absent on records created before SIM-21 — callers default it. */
  preferences?: UserPreferences;
  /** Absent on records created before SIM-15 — callers default it. */
  dietary?: DietaryPreferences;
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
  /** Household favourite flag (SIM-13). */
  favourite: boolean;
  /** ISO timestamp the recipe was last cooked/used, or null (SIM-13). */
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Per-recipe pantry availability, computed against current stock (SIM-13). */
export interface RecipeAvailability {
  totalCount: number;
  availableCount: number;
  makeable: boolean;
}

// --- Meal plans (SIM-16) ----------------------------------------------------

export type MealType = 'breakfast' | 'lunch' | 'dinner';
export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner'];
export const DAYS_OF_WEEK: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// --- Weekly schedule (SIM-18) -----------------------------------------------

export type NightBusyness = 'busy' | 'normal' | 'free';

export interface ScheduleDay {
  busyness: NightBusyness;
  /** Optional recurring label, e.g. "soccer night". */
  label: string;
}

export interface WeeklyScheduleRecord {
  userId: string;
  /** Per weekday busyness/label; missing days default to 'normal'. */
  days: Partial<Record<DayOfWeek, ScheduleDay>>;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_SCHEDULE_DAY: ScheduleDay = { busyness: 'normal', label: '' };

export interface MealPlanSlot {
  /** Assigned recipe, or null for a free-text/empty slot. */
  recipeId: string | null;
  /** Denormalised recipe name for display without a join. */
  recipeName: string;
  note: string;
}

export interface MealPlanRecord {
  householdId: string;
  /** ISO date (YYYY-MM-DD) of the week's Monday. */
  weekStartDate: string;
  /** Keyed by `${day}:${mealType}`, e.g. "mon:dinner". */
  slots: Record<string, MealPlanSlot>;
  createdAt: string;
  updatedAt: string;
}

// --- Shopping list (SIM-17) -------------------------------------------------

export type StoreSection = 'produce' | 'dairy' | 'meat' | 'bakery' | 'frozen' | 'pantry' | 'other';

export interface GroceryItemRecord {
  groceryItemId: string;
  householdId: string;
  name: string;
  quantity: number | null;
  unit: QuantityUnit | null;
  section: StoreSection;
  checked: boolean;
  /** 'auto' items are regenerated from the meal plan; 'manual' are user-added. */
  source: 'auto' | 'manual';
  createdAt: string;
  updatedAt: string;
}
