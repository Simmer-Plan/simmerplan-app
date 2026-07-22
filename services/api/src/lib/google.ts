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

// Google ID token verification against Google's public JWKS.

import type { JwtPayload } from 'jsonwebtoken';
import { jwksResolver, verifyJwt, type KeyResolver } from './jwt';

const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export interface GoogleIdentity {
  googleId: string;
  email: string;
  name: string;
  photoUrl: string;
}

export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
  resolve: KeyResolver = jwksResolver(GOOGLE_JWKS),
): Promise<GoogleIdentity> {
  let payload: JwtPayload | undefined;
  let lastErr: unknown;
  for (const issuer of GOOGLE_ISSUERS) {
    try {
      payload = await verifyJwt(idToken, resolve, { issuer, audience: clientId });
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!payload) throw lastErr ?? new Error('Google token verification failed');
  if (!payload.sub || !payload.email) throw new Error('Google token missing sub/email');
  return {
    googleId: payload.sub,
    email: String(payload.email),
    name: String(payload.name ?? payload.email),
    photoUrl: String(payload.picture ?? ''),
  };
}
