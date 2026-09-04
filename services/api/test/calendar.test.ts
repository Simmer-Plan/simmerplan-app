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
import { busyDaysFromEvents, parseCalendarEvents } from '../src/lib/calendar';

describe('parseCalendarEvents', () => {
  it('keeps timed events and drops all-day entries', () => {
    const events = parseCalendarEvents({
      items: [
        { summary: 'Soccer', start: { dateTime: '2026-09-08T18:30:00-04:00' } },
        { summary: 'Holiday', start: { date: '2026-09-09' } },
        { summary: 'No start' },
      ],
    });
    expect(events).toEqual([{ start: '2026-09-08T18:30:00-04:00', summary: 'Soccer' }]);
  });

  it('returns [] for a malformed response', () => {
    expect(parseCalendarEvents(null)).toEqual([]);
    expect(parseCalendarEvents({})).toEqual([]);
  });
});

describe('busyDaysFromEvents', () => {
  it('flags weeknights with an evening event, in week order', () => {
    // 2026-09-08 is a Tuesday, 2026-09-10 a Thursday.
    const days = busyDaysFromEvents([
      { start: '2026-09-08T18:30:00-04:00' }, // Tue evening -> busy
      { start: '2026-09-10T19:00:00-04:00' }, // Thu evening -> busy
      { start: '2026-09-09T09:00:00-04:00' }, // Wed morning -> not evening
    ]);
    expect(days).toEqual(['tue', 'thu']);
  });

  it('ignores daytime events', () => {
    expect(busyDaysFromEvents([{ start: '2026-09-08T12:00:00-04:00' }])).toEqual([]);
  });
});
