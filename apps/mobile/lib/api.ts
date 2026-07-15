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

// Typed API client (SIM-29). Exposes a tRPC-style surface (api.auth.google
// .mutate(...)) backed by fetch — real tRPC adoption is a separate decision
// once the API grows. Attaches the Cognito ID token as the Bearer token
// (custom:householdId only exists in ID tokens) and retries once through a
// refresh on 401.

import * as SecureStore from 'expo-secure-store';
import type {
  AuthGoogleRequest,
  AuthGoogleResponse,
  AuthRefreshResponse,
  HouseholdCreateRequest,
  HouseholdCreateResponse,
  HouseholdGetResponse,
  HouseholdInviteResponse,
  HouseholdJoinRequest,
  HouseholdJoinResponse,
} from '@simmerplan/types';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  { auth = true, retried = false }: { auth?: boolean; retried?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) {
    const idToken = await SecureStore.getItemAsync('cognito.idToken');
    if (idToken) headers.authorization = `Bearer ${idToken}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401 && auth && !retried) {
    const { refreshTokens } = await import('./auth');
    await refreshTokens();
    return request<T>(method, path, body, { auth, retried: true });
  }
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(response.status, detail.error ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export const api = {
  auth: {
    google: {
      mutate: (input: AuthGoogleRequest) =>
        request<AuthGoogleResponse>('POST', '/auth/google', input, { auth: false }),
    },
    refresh: {
      mutate: (input: { refreshToken: string }) =>
        request<AuthRefreshResponse>('POST', '/auth/refresh', input, { auth: false }),
    },
  },
  household: {
    create: {
      mutate: (input: HouseholdCreateRequest) =>
        request<HouseholdCreateResponse>('POST', '/household/create', input),
    },
    invite: {
      mutate: () => request<HouseholdInviteResponse>('POST', '/household/invite', {}),
    },
    join: {
      mutate: (input: HouseholdJoinRequest) =>
        request<HouseholdJoinResponse>('POST', '/household/join', input),
    },
    get: {
      query: () => request<HouseholdGetResponse>('GET', '/household'),
    },
  },
};
