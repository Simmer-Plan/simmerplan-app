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

// Secrets Manager access with per-container caching. Secrets live at
// simmerplan/<env>/<name> (see CLAUDE.md); values are never placed in env vars.

import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const CACHE_TTL_MS = 5 * 60 * 1000;

const client = new SecretsManagerClient({});
const cache = new Map<string, { value: string; fetchedAt: number }>();

export function secretId(name: string): string {
  const env = process.env.ENVIRONMENT ?? 'sandbox';
  return `simmerplan/${env}/${name}`;
}

export async function getSecret(
  name: string,
  send: (id: string) => Promise<string | undefined> = async (id) =>
    (await client.send(new GetSecretValueCommand({ SecretId: id }))).SecretString,
): Promise<string> {
  const id = secretId(name);
  const hit = cache.get(id);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.value;
  const value = await send(id);
  if (!value) throw new Error(`Secret ${id} is empty`);
  cache.set(id, { value, fetchedAt: Date.now() });
  return value;
}
