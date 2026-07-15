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

// Auth endpoints (SIM-29): POST /auth/google, POST /auth/refresh.
// Route: /auth/{proxy+} — unauthenticated (this is where tokens come from).

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type {
  AuthGoogleRequest,
  AuthGoogleResponse,
  AuthRefreshRequest,
  UserRecord,
} from '@simmerplan/types';
import { docClient, TABLE_NAME } from '../lib/dynamo';
import { ensureCognitoUser, exchangeGoogleIdToken, refreshTokens } from '../lib/cognito';
import { verifyGoogleIdToken } from '../lib/google';
import { getSecret } from '../lib/secrets';
import { errorResponse, HttpError, json, parseBody, routeKey } from '../lib/http';

async function handleGoogle(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const { idToken } = parseBody<AuthGoogleRequest>(event);
  if (!idToken) throw new HttpError(400, 'idToken is required');

  const googleClientId = await getSecret('google-oauth-client-id');
  const identity = await verifyGoogleIdToken(idToken, googleClientId).catch(() => {
    throw new HttpError(401, 'Invalid Google token');
  });

  await ensureCognitoUser(identity);
  const cognitoTokens = await exchangeGoogleIdToken(identity.googleId, idToken);

  const userId = identity.googleId;
  const existing = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: `USER#${userId}`, SK: 'METADATA' } }),
  );

  let user = existing.Item as (UserRecord & { PK: string; SK: string }) | undefined;
  const isNewUser = !user;
  if (!user) {
    const now = new Date().toISOString();
    user = {
      PK: `USER#${userId}`,
      SK: 'METADATA',
      userId,
      householdId: null,
      role: null,
      googleId: identity.googleId,
      email: identity.email,
      name: identity.name,
      photoUrl: identity.photoUrl,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: user }));
  }

  const response: AuthGoogleResponse = {
    cognitoTokens,
    user: {
      userId: user.userId,
      email: user.email,
      name: user.name,
      photoUrl: user.photoUrl,
      householdId: user.householdId,
      role: user.role,
    },
    isNewUser,
  };
  return json(200, response);
}

async function handleRefresh(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const { refreshToken } = parseBody<AuthRefreshRequest>(event);
  if (!refreshToken) throw new HttpError(400, 'refreshToken is required');
  const tokens = await refreshTokens(refreshToken).catch(() => {
    throw new HttpError(401, 'Invalid refresh token');
  });
  return json(200, { tokens });
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    switch (routeKey(event)) {
      case 'POST /auth/google':
        return await handleGoogle(event);
      case 'POST /auth/refresh':
        return await handleRefresh(event);
      default:
        throw new HttpError(404, 'Not found');
    }
  } catch (err) {
    return errorResponse(err);
  }
};
