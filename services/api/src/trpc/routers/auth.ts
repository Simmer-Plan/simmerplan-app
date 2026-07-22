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

// Auth router (SIM-29): auth.google, auth.refresh. Public — this is where
// tokens come from, so these procedures run without the Lambda authorizer.

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { AuthGoogleResponse, AuthRefreshResponse, UserRecord } from '@simmerplan/types';
import { docClient, TABLE_NAME } from '../../lib/dynamo';
import { ensureCognitoUser, exchangeGoogleIdToken, refreshTokens } from '../../lib/cognito';
import { verifyGoogleIdToken } from '../../lib/google';
import { getSecret } from '../../lib/secrets';
import { publicProcedure, router } from '../trpc';

export const authRouter = router({
  // POST /auth/google — exchange a Google idToken for Cognito tokens.
  google: publicProcedure
    .input(z.object({ idToken: z.string().min(1) }))
    .mutation(async ({ input }): Promise<AuthGoogleResponse> => {
      const googleClientId = await getSecret('google-oauth-client-id');
      const identity = await verifyGoogleIdToken(input.idToken, googleClientId).catch(() => {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid Google token' });
      });

      await ensureCognitoUser(identity);
      const cognitoTokens = await exchangeGoogleIdToken(identity.googleId, input.idToken);

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

      return {
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
    }),

  // POST /auth/refresh — exchange a refresh token for fresh access/id tokens.
  refresh: publicProcedure
    .input(z.object({ refreshToken: z.string().min(1) }))
    .mutation(async ({ input }): Promise<AuthRefreshResponse> => {
      const tokens = await refreshTokens(input.refreshToken).catch(() => {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid refresh token' });
      });
      return { tokens };
    }),
});

export type AuthRouter = typeof authRouter;
