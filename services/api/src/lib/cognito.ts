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

// Cognito user pool operations for the Google federated sign-in flow.
//
// Native Google sign-in cannot exchange a Google idToken for user pool tokens
// directly; the standard pattern is Cognito's CUSTOM_AUTH flow, where the
// verify-auth-challenge trigger validates the Google idToken (see
// cognito-verify-auth-challenge.ts). This module wraps that exchange.

import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  UserNotFoundException,
  type AuthenticationResultType,
} from '@aws-sdk/client-cognito-identity-provider';
import { randomBytes, randomUUID } from 'crypto';
import type { GoogleIdentity } from './google';

const client = new CognitoIdentityProviderClient({});

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? '';
const CLIENT_ID = process.env.COGNITO_CLIENT_ID ?? '';

export interface CognitoTokenSet {
  accessToken: string;
  idToken: string;
  refreshToken: string;
}

function toTokens(result: AuthenticationResultType | undefined): CognitoTokenSet {
  if (!result?.AccessToken || !result.IdToken) {
    throw new Error('Cognito returned no tokens');
  }
  return {
    accessToken: result.AccessToken,
    idToken: result.IdToken,
    refreshToken: result.RefreshToken ?? '',
  };
}

/**
 * Ensure a Cognito user exists for this Google identity. Users are keyed by
 * the Google sub. Newly created users get a random permanent password purely
 * to reach CONFIRMED status — password auth flows are disabled on the client.
 */
export async function ensureCognitoUser(identity: GoogleIdentity, cognito = client): Promise<void> {
  try {
    await cognito.send(
      new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: identity.googleId }),
    );
    return;
  } catch (err) {
    if (!(err instanceof UserNotFoundException)) throw err;
  }

  await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: identity.googleId,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: identity.email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name', Value: identity.name },
      ],
    }),
  );
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: identity.googleId,
      Password: `A1!${randomBytes(24).toString('base64url')}${randomUUID()}`,
      Permanent: true,
    }),
  );
}

/** CUSTOM_AUTH exchange: the Google idToken is the challenge answer. */
export async function exchangeGoogleIdToken(
  googleId: string,
  googleIdToken: string,
  cognito = client,
): Promise<CognitoTokenSet> {
  const initiate = await cognito.send(
    new InitiateAuthCommand({
      ClientId: CLIENT_ID,
      AuthFlow: 'CUSTOM_AUTH',
      AuthParameters: { USERNAME: googleId },
    }),
  );
  if (initiate.AuthenticationResult) return toTokens(initiate.AuthenticationResult);

  const respond = await cognito.send(
    new RespondToAuthChallengeCommand({
      ClientId: CLIENT_ID,
      ChallengeName: 'CUSTOM_CHALLENGE',
      Session: initiate.Session,
      ChallengeResponses: { USERNAME: googleId, ANSWER: googleIdToken },
    }),
  );
  return toTokens(respond.AuthenticationResult);
}

export async function refreshTokens(
  refreshToken: string,
  cognito = client,
): Promise<Omit<CognitoTokenSet, 'refreshToken'>> {
  const result = await cognito.send(
    new InitiateAuthCommand({
      ClientId: CLIENT_ID,
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    }),
  );
  const tokens = toTokens(result.AuthenticationResult);
  return { accessToken: tokens.accessToken, idToken: tokens.idToken };
}

export async function setHouseholdClaim(
  userId: string,
  householdId: string,
  cognito = client,
): Promise<void> {
  await cognito.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: userId,
      UserAttributes: [{ Name: 'custom:householdId', Value: householdId }],
    }),
  );
}
