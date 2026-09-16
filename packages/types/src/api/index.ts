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

import type {
  DayOfWeek,
  DietaryPreferences,
  MealPlanSlot,
  RecipeComplexity,
  RecipeIngredient,
  Role,
  ScheduleDay,
  StorageLocationKind,
  UserPreferences,
} from '../entities';

export interface CognitoTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
}

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  photoUrl: string;
  householdId: string | null;
  role: Role | null;
}

export interface AuthGoogleRequest {
  idToken: string;
}

export interface AuthGoogleResponse {
  cognitoTokens: CognitoTokens;
  user: AuthUser;
  isNewUser: boolean;
}

export interface AuthRefreshRequest {
  refreshToken: string;
}

export interface AuthRefreshResponse {
  tokens: Omit<CognitoTokens, 'refreshToken'>;
}

export interface HouseholdCreateRequest {
  name: string;
  /** When provided, the response includes tokens refreshed with the new householdId claim. */
  refreshToken?: string;
}

export interface HouseholdCreateResponse {
  householdId: string;
  name: string;
  role: Role;
  tokens: Omit<CognitoTokens, 'refreshToken'> | null;
}

export interface HouseholdInviteResponse {
  inviteUrl: string;
  expiresAt: string;
}

export interface HouseholdJoinRequest {
  token: string;
  refreshToken?: string;
}

export interface HouseholdJoinResponse {
  householdId: string;
  name: string;
  role: Role;
  tokens: Omit<CognitoTokens, 'refreshToken'> | null;
}

export interface HouseholdMember {
  userId: string;
  name: string;
  email: string;
  photoUrl: string;
  role: Role | null;
  /** Individual dietary preferences, surfaced for household meal planning (SIM-15). */
  dietary: DietaryPreferences;
}

export interface HouseholdGetResponse {
  householdId: string;
  name: string;
  members: HouseholdMember[];
}

/** The signed-in user's profile + notification preferences (SIM-21). */
export interface ProfileResponse {
  userId: string;
  name: string;
  email: string;
  photoUrl: string;
  householdId: string | null;
  role: Role | null;
  preferences: UserPreferences;
  dietary: DietaryPreferences;
}

/** An editable recipe draft — e.g. parsed from an imported URL (SIM-12). */
export interface RecipeDraft {
  name: string;
  description: string;
  photoUrl: string | null;
  ingredients: RecipeIngredient[];
  instructions: string[];
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  complexity: RecipeComplexity;
  tags: string[];
}

/** Result of a barcode/UPC product lookup (SIM-10). */
export interface BarcodeLookupResult {
  barcode: string;
  found: boolean;
  name: string | null;
  brand: string | null;
  category: string | null;
  suggestedLocationKind: StorageLocationKind;
}

/** A week's meal plan (SIM-16). */
export interface MealPlanWeek {
  weekStartDate: string;
  slots: Record<string, MealPlanSlot>;
}

/** The signed-in user's weekly schedule (SIM-18). */
export interface WeeklySchedule {
  days: Partial<Record<DayOfWeek, ScheduleDay>>;
}

/** An AI-generated meal suggestion (SIM-14). */
export interface MealSuggestion {
  title: string;
  description: string;
  /** Matching saved recipe id, or null for a new idea. */
  recipeId: string | null;
  usesPantryItems: string[];
}

/** Request context injected by the Lambda authorizer. */
export interface AuthContext {
  userId: string;
  /** Empty string until the user creates or joins a household. */
  householdId: string;
}
