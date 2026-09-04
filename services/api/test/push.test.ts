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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildExpoMessages, sendPush } from '../src/lib/push';

describe('buildExpoMessages', () => {
  it('builds one message per token with defaults', () => {
    const msgs = buildExpoMessages(['ExponentPushToken[a]', 'ExponentPushToken[b]'], { title: 'Hi', body: 'There' });
    expect(msgs).toEqual([
      { to: 'ExponentPushToken[a]', title: 'Hi', body: 'There', data: {}, sound: 'default' },
      { to: 'ExponentPushToken[b]', title: 'Hi', body: 'There', data: {}, sound: 'default' },
    ]);
  });
});

describe('sendPush', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('no-ops with an empty token list (no fetch)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendPush([], { title: 'x', body: 'y' })).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to Expo and returns the count', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendPush(['ExponentPushToken[a]'], { title: 'x', body: 'y' })).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    await expect(sendPush(['ExponentPushToken[a]'], { title: 'x', body: 'y' })).rejects.toThrow(/status 500/);
  });
});
