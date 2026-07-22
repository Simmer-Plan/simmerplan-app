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

import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';
import { verifyJwt } from '../src/lib/jwt';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

describe('verifyJwt', () => {
  it('verifies issuer, audience, and signature', async () => {
    const token = jwt.sign({ sub: 'u1' }, privateKey, {
      algorithm: 'RS256',
      issuer: 'https://issuer.example',
      audience: 'client-1',
      expiresIn: '5m',
    });
    const claims = await verifyJwt(token, async () => pem, {
      issuer: 'https://issuer.example',
      audience: 'client-1',
    });
    expect(claims.sub).toBe('u1');
  });

  it('rejects wrong issuer', async () => {
    const token = jwt.sign({ sub: 'u1' }, privateKey, {
      algorithm: 'RS256',
      issuer: 'https://evil.example',
      expiresIn: '5m',
    });
    await expect(
      verifyJwt(token, async () => pem, { issuer: 'https://issuer.example' }),
    ).rejects.toThrow();
  });

  it('rejects HS256 tokens (algorithm confusion)', async () => {
    const token = jwt.sign({ sub: 'u1' }, 'symmetric-secret', {
      algorithm: 'HS256',
      issuer: 'https://issuer.example',
      expiresIn: '5m',
    });
    await expect(
      verifyJwt(token, async () => pem, { issuer: 'https://issuer.example' }),
    ).rejects.toThrow();
  });

  it('rejects garbage', async () => {
    await expect(verifyJwt('not-a-token', async () => pem, { issuer: 'x' })).rejects.toThrow();
  });
});
