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

// Weekly schedule router (SIM-18): the signed-in user's per-weeknight
// busyness/labels, stored at USER#<userId> / SCHEDULE#WEEKLY. Feeds meal
// suggestions (simple meals on busy nights). Behind the Lambda authorizer.

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { CalendarSyncResult, WeeklySchedule, WeeklyScheduleRecord } from '@simmerplan/types';
import { DAYS_OF_WEEK } from '@simmerplan/types';
import { docClient, TABLE_NAME } from '../../lib/dynamo';
import { busyDaysFromEvents, parseCalendarEvents } from '../../lib/calendar';
import { protectedProcedure, router } from '../trpc';

const CALENDAR_ENDPOINT = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

const scheduleKey = (userId: string) => ({ PK: `USER#${userId}`, SK: 'SCHEDULE#WEEKLY' });
const dayEnum = z.enum(DAYS_OF_WEEK as [string, ...string[]]);
const busynessEnum = z.enum(['busy', 'normal', 'free']);

async function loadDays(userId: string): Promise<WeeklyScheduleRecord['days']> {
  const result = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: scheduleKey(userId) }));
  return (result.Item as WeeklyScheduleRecord | undefined)?.days ?? {};
}

export const scheduleRouter = router({
  get: protectedProcedure.query(async ({ ctx }): Promise<WeeklySchedule> => {
    return { days: await loadDays(ctx.userId) };
  }),

  setDay: protectedProcedure
    .input(
      z.object({
        day: dayEnum,
        busyness: busynessEnum,
        label: z.string().trim().max(80).default(''),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<WeeklySchedule> => {
      const now = new Date().toISOString();
      // Ensure the item + days map exist, then set the one day's entry.
      const result = await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: scheduleKey(ctx.userId),
          UpdateExpression:
            'SET days = if_not_exists(days, :empty), userId = :uid, createdAt = if_not_exists(createdAt, :now), updatedAt = :now',
          ExpressionAttributeValues: { ':empty': {}, ':uid': ctx.userId, ':now': now },
          ReturnValues: 'NONE',
        }),
      ).then(() =>
        docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: scheduleKey(ctx.userId),
            UpdateExpression: 'SET days.#d = :entry, updatedAt = :now',
            ExpressionAttributeNames: { '#d': input.day },
            ExpressionAttributeValues: {
              ':entry': { busyness: input.busyness, label: input.label },
              ':now': now,
            },
            ReturnValues: 'ALL_NEW',
          }),
        ),
      );
      return { days: (result.Attributes as WeeklyScheduleRecord).days ?? {} };
    }),

  // Sync busy evenings from Google Calendar (SIM-19). The client passes a Google
  // access token carrying the calendar.readonly scope; we read the next 7 days'
  // events, flag weeknights with an evening commitment as 'busy', and merge that
  // into the stored schedule (preserving existing labels). Calendar write-back
  // of the meal plan is a later enhancement (needs the write scope).
  syncFromGoogleCalendar: protectedProcedure
    .input(z.object({ accessToken: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<CalendarSyncResult> => {
      const now = new Date();
      const weekLater = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
      const url = `${CALENDAR_ENDPOINT}?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(now.toISOString())}&timeMax=${encodeURIComponent(weekLater.toISOString())}`;

      let busyDays;
      try {
        const res = await fetch(url, { headers: { authorization: `Bearer ${input.accessToken}` } });
        if (!res.ok) throw new Error(`status ${res.status}`);
        busyDays = busyDaysFromEvents(parseCalendarEvents(await res.json()));
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message: `Calendar sync failed: ${(err as Error).message}`,
        });
      }

      const days = { ...(await loadDays(ctx.userId)) };
      for (const day of busyDays) {
        days[day] = { busyness: 'busy', label: days[day]?.label ?? '' };
      }
      const nowIso = now.toISOString();
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            ...scheduleKey(ctx.userId),
            userId: ctx.userId,
            days,
            createdAt: nowIso,
            updatedAt: nowIso,
          } satisfies WeeklyScheduleRecord & { PK: string; SK: string },
        }),
      );

      return { busyDays, days };
    }),
});

export type ScheduleRouter = typeof scheduleRouter;
