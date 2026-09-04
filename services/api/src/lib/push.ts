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

// Push notification delivery (SIM-22) via the Expo Push API. Message building
// is a pure function; sendPush does the POST. Delivery is triggered by
// scheduled jobs (e.g. nightly expiry alerts, weekly plan reminders) that read
// user preferences — those triggers are a follow-up.

import type { PushNotification } from '@simmerplan/types';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound: 'default';
}

/** Build one Expo push message per device token. Pure. */
export function buildExpoMessages(tokens: string[], notification: PushNotification): ExpoPushMessage[] {
  return tokens.map((to) => ({
    to,
    title: notification.title,
    body: notification.body,
    data: notification.data ?? {},
    sound: 'default',
  }));
}

/** Deliver a notification to the given device tokens. Returns the count sent. */
export async function sendPush(tokens: string[], notification: PushNotification): Promise<number> {
  if (tokens.length === 0) return 0;
  const res = await fetch(EXPO_PUSH_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(buildExpoMessages(tokens, notification)),
  });
  if (!res.ok) throw new Error(`Expo push failed: status ${res.status}`);
  return tokens.length;
}
