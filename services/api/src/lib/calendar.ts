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

// Google Calendar helpers (SIM-19). Pure functions that turn a Calendar events
// list into the set of weeknights with evening commitments; the schedule router
// does the OAuth-authenticated fetch.

import type { DayOfWeek } from '@simmerplan/types';
import { DAYS_OF_WEEK } from '@simmerplan/types';

const DOW: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export interface CalendarEvent {
  /** RFC3339 timestamp with offset, e.g. 2026-09-08T18:30:00-04:00. */
  start: string;
  summary?: string;
}

/** Wall-clock hour written in an RFC3339 timestamp (user-local), or null. */
function localHour(dt: string): number | null {
  const m = /T(\d{2}):/.exec(dt);
  return m ? Number(m[1]) : null;
}

/** Weekday of a timestamp's date portion (offset-agnostic — uses the date as written). */
function weekdayOf(dt: string): DayOfWeek | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(dt);
  if (!m) return null;
  const day = new Date(`${m[1]}T12:00:00Z`).getUTCDay();
  return DOW[day] ?? null;
}

/** Extract timed events (skip all-day date-only entries) from a Calendar list response. */
export function parseCalendarEvents(json: unknown): CalendarEvent[] {
  const items = (json as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: CalendarEvent[] = [];
  for (const item of items) {
    const start = (item as { start?: { dateTime?: unknown } }).start?.dateTime;
    if (typeof start === 'string') {
      out.push({ start, summary: String((item as { summary?: unknown }).summary ?? '') });
    }
  }
  return out;
}

/** Weeknights (mon..sun order) that have an event in the evening window. */
export function busyDaysFromEvents(
  events: CalendarEvent[],
  eveningStartHour = 17,
  eveningEndHour = 22,
): DayOfWeek[] {
  const busy = new Set<DayOfWeek>();
  for (const event of events) {
    const hour = localHour(event.start);
    const day = weekdayOf(event.start);
    if (hour != null && day && hour >= eveningStartHour && hour < eveningEndHour) busy.add(day);
  }
  return DAYS_OF_WEEK.filter((d) => busy.has(d));
}
