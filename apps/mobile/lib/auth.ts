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

// Google Sign-In + Cognito token management (SIM-29). Tokens live exclusively
// in expo-secure-store — never AsyncStorage. householdId is always read from
// the decoded ID token claim, never stored separately.

import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as SecureStore from 'expo-secure-store';
import type { AuthGoogleResponse, CognitoTokens } from '@simmerplan/types';
import { api } from './api';

GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  offlineAccess: false,
});

const KEYS = {
  accessToken: 'cognito.accessToken',
  idToken: 'cognito.idToken',
  refreshToken: 'cognito.refreshToken',
  userId: 'auth.userId',
} as const;

async function storeTokens(tokens: Partial<CognitoTokens>): Promise<void> {
  if (tokens.accessToken) await SecureStore.setItemAsync(KEYS.accessToken, tokens.accessToken);
  if (tokens.idToken) await SecureStore.setItemAsync(KEYS.idToken, tokens.idToken);
  if (tokens.refreshToken) await SecureStore.setItemAsync(KEYS.refreshToken, tokens.refreshToken);
}

/** householdId comes from the verified ID token claim — decode, never trust storage. */
export function householdIdFromIdToken(idToken: string): string | null {
  try {
    // base64url → base64, padded; Hermes provides atob (Buffer does not exist in RN).
    const b64 = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
    const value = payload['custom:householdId'];
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function signInWithGoogle(): Promise<AuthGoogleResponse> {
  await GoogleSignin.hasPlayServices();
  const result = await GoogleSignin.signIn();
  const idToken = result.data?.idToken;
  if (!idToken) throw new Error('Google sign-in returned no idToken');

  const response = await api.auth.google.mutate({ idToken });
  await storeTokens(response.cognitoTokens);
  await SecureStore.setItemAsync(KEYS.userId, response.user.userId);
  return response;
}

export async function refreshTokens(): Promise<string> {
  const refreshToken = await SecureStore.getItemAsync(KEYS.refreshToken);
  if (!refreshToken) throw new Error('No refresh token stored');
  const { tokens } = await api.auth.refresh.mutate({ refreshToken });
  await storeTokens(tokens);
  return tokens.accessToken;
}

export async function getStoredIdToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.idToken);
}

/**
 * Obtain a Google access token carrying the calendar.readonly scope (SIM-19).
 * Requires the scope to be granted on the OAuth consent screen; the first call
 * prompts the user to grant calendar access.
 */
export async function getCalendarAccessToken(): Promise<string> {
  await GoogleSignin.addScopes({ scopes: ['https://www.googleapis.com/auth/calendar.readonly'] });
  const { accessToken } = await GoogleSignin.getTokens();
  return accessToken;
}

/**
 * Create a household and adopt the refreshed tokens (the new ID token carries
 * custom:householdId). Passing the stored refresh token lets the server mint
 * them in the same round-trip.
 */
export async function createHousehold(name: string): Promise<void> {
  const refreshToken = (await SecureStore.getItemAsync(KEYS.refreshToken)) ?? undefined;
  const { tokens } = await api.household.create.mutate({ name, refreshToken });
  if (tokens) await storeTokens(tokens);
}

/** Join a household via an invite token, then adopt the refreshed tokens. */
export async function joinHousehold(token: string): Promise<void> {
  const refreshToken = (await SecureStore.getItemAsync(KEYS.refreshToken)) ?? undefined;
  const { tokens } = await api.household.join.mutate({ token, refreshToken });
  if (tokens) await storeTokens(tokens);
}

export async function signOut(): Promise<void> {
  await GoogleSignin.signOut().catch(() => undefined);
  await Promise.all(Object.values(KEYS).map((k) => SecureStore.deleteItemAsync(k)));
}
