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

// JWT verification with a module-level JWKS cache. The JWKS client is created
// once per Lambda container and jwks-rsa caches keys for JWKS_CACHE_MS, so
// verification does not refetch the JWKS per invocation (SIM-29 requirement).

import jwt, { type JwtHeader, type JwtPayload } from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';

const JWKS_CACHE_MS = 60 * 60 * 1000; // 1 hour

/** Resolves a JWT `kid` to a PEM public key. Injectable for tests. */
export type KeyResolver = (kid: string | undefined) => Promise<string>;

const clients = new Map<string, JwksClient>();

export function jwksResolver(jwksUri: string): KeyResolver {
  let client = clients.get(jwksUri);
  if (!client) {
    client = new JwksClient({
      jwksUri,
      cache: true,
      cacheMaxAge: JWKS_CACHE_MS,
      rateLimit: true,
    });
    clients.set(jwksUri, client);
  }
  const c = client;
  return async (kid) => (await c.getSigningKey(kid)).getPublicKey();
}

export interface VerifyOptions {
  issuer: string;
  audience?: string;
}

export async function verifyJwt(
  token: string,
  resolve: KeyResolver,
  options: VerifyOptions,
): Promise<JwtPayload> {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string') throw new Error('Malformed token');
  const header = decoded.header as JwtHeader;
  const pem = await resolve(header.kid);
  return new Promise((resolvePromise, reject) => {
    jwt.verify(
      token,
      pem,
      { issuer: options.issuer, audience: options.audience, algorithms: ['RS256'] },
      (err, payload) => {
        if (err || !payload || typeof payload === 'string') {
          reject(err ?? new Error('Invalid token payload'));
        } else {
          resolvePromise(payload);
        }
      },
    );
  });
}
