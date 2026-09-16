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

// End-to-end typed tRPC client (SIM-29). Two clients mirror the API's
// public/protected split: `auth` is unauthenticated (that's where tokens come
// from), `household` sits behind the Lambda authorizer. Non-batching httpLink
// so each call maps to POST/GET /<router>/<procedure> and matches the existing
// API Gateway {proxy+} routes. The protected client attaches the Cognito ID
// token as Bearer (custom:householdId only lives in ID tokens) and retries once
// through a refresh on 401.

import * as SecureStore from 'expo-secure-store';
import { createTRPCClient, httpLink } from '@trpc/client';
import type {
  AuthRouter,
  HouseholdRouter,
  MealplanRouter,
  PantryRouter,
  ProfileRouter,
  RecipeRouter,
} from '@simmerplan/api/router';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

// fetch wrapper for the protected client: attach the ID token, and on a 401
// refresh once and retry. Refresh is imported lazily to avoid an import cycle
// with ./auth (which imports this module).
// tRPC's httpLink invokes fetch with (RequestInfo | URL, RequestInit); React
// Native's fetch takes RequestInfo, and tRPC only ever passes a string URL.
const authedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const withToken = async (): Promise<RequestInit> => {
    const idToken = await SecureStore.getItemAsync('cognito.idToken');
    const headers = new Headers(init?.headers);
    if (idToken) headers.set('authorization', `Bearer ${idToken}`);
    return { ...init, headers };
  };

  const url = input as RequestInfo;
  let response = await fetch(url, await withToken());
  if (response.status === 401) {
    try {
      const { refreshTokens } = await import('./auth');
      await refreshTokens();
    } catch {
      return response;
    }
    response = await fetch(url, await withToken());
  }
  return response;
};

const authClient = createTRPCClient<AuthRouter>({
  links: [httpLink({ url: `${BASE_URL}/auth` })],
});

const householdClient = createTRPCClient<HouseholdRouter>({
  links: [httpLink({ url: `${BASE_URL}/household`, fetch: authedFetch })],
});

const pantryClient = createTRPCClient<PantryRouter>({
  links: [httpLink({ url: `${BASE_URL}/pantry`, fetch: authedFetch })],
});

const recipeClient = createTRPCClient<RecipeRouter>({
  links: [httpLink({ url: `${BASE_URL}/recipes`, fetch: authedFetch })],
});

const profileClient = createTRPCClient<ProfileRouter>({
  links: [httpLink({ url: `${BASE_URL}/profile`, fetch: authedFetch })],
});

const mealplanClient = createTRPCClient<MealplanRouter>({
  links: [httpLink({ url: `${BASE_URL}/mealplans`, fetch: authedFetch })],
});

export const api = {
  auth: authClient,
  household: householdClient,
  pantry: pantryClient,
  recipes: recipeClient,
  profile: profileClient,
  mealplans: mealplanClient,
};
