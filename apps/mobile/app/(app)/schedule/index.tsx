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

// Weekly schedule (SIM-18): mark each weeknight Busy / Normal / Free and add a
// recurring label. Meal suggestions use this to favour simple meals on busy
// nights. Google Calendar auto-detection is a later integration (SIM-19).

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { DayOfWeek, NightBusyness, ScheduleDay } from '@simmerplan/types';
import { DAYS_OF_WEEK, DEFAULT_SCHEDULE_DAY } from '@simmerplan/types';
import { api } from '../../../lib/api';
import { getCalendarAccessToken } from '../../../lib/auth';

const DAY_LABEL: Record<DayOfWeek, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};
const BUSYNESS: NightBusyness[] = ['busy', 'normal', 'free'];
const BUSY_COLOR: Record<NightBusyness, string> = { busy: '#c0392b', normal: '#7f8c8d', free: '#27ae60' };

export default function ScheduleScreen() {
  const [days, setDays] = useState<Record<DayOfWeek, ScheduleDay>>(() =>
    Object.fromEntries(DAYS_OF_WEEK.map((d) => [d, { ...DEFAULT_SCHEDULE_DAY }])) as Record<DayOfWeek, ScheduleDay>,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.schedule.get.query();
      setDays((prev) => {
        const next = { ...prev };
        for (const d of DAYS_OF_WEEK) next[d] = { ...DEFAULT_SCHEDULE_DAY, ...(res.days[d] ?? {}) };
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(day: DayOfWeek, entry: ScheduleDay) {
    setDays((prev) => ({ ...prev, [day]: entry }));
    try {
      await api.schedule.setDay.mutate({ day, busyness: entry.busyness, label: entry.label });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      await load();
    }
  }

  async function syncCalendar() {
    setSyncing(true);
    setError(null);
    try {
      const accessToken = await getCalendarAccessToken();
      const res = await api.schedule.syncFromGoogleCalendar.mutate({ accessToken });
      setDays((prev) => {
        const next = { ...prev };
        for (const d of DAYS_OF_WEEK) next[d] = { ...DEFAULT_SCHEDULE_DAY, ...(res.days[d] ?? {}) };
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Calendar sync failed');
    } finally {
      setSyncing(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Weekly schedule</Text>
      <Text style={styles.hint}>Busy nights get simpler meal suggestions.</Text>
      <Button title={syncing ? 'Syncing…' : 'Sync busy nights from Google Calendar'} onPress={syncCalendar} disabled={syncing} />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {DAYS_OF_WEEK.map((day) => {
        const entry = days[day];
        return (
          <View key={day} style={styles.dayCard}>
            <Text style={styles.dayName}>{DAY_LABEL[day]}</Text>
            <View style={styles.chipRow}>
              {BUSYNESS.map((b) => (
                <Pressable
                  key={b}
                  onPress={() => save(day, { ...entry, busyness: b })}
                  style={[styles.chip, entry.busyness === b && { backgroundColor: BUSY_COLOR[b], borderColor: BUSY_COLOR[b] }]}
                >
                  <Text style={[styles.chipText, entry.busyness === b && styles.chipTextActive]}>{b}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={styles.input}
              placeholder="Label (e.g. soccer night)"
              value={entry.label}
              onChangeText={(label) => setDays((prev) => ({ ...prev, [day]: { ...prev[day], label } }))}
              onBlur={() => save(day, days[day])}
            />
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 10 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '600' },
  hint: { fontSize: 12, color: '#888' },
  dayCard: { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 10, padding: 12, gap: 8 },
  dayName: { fontSize: 16, fontWeight: '600' },
  chipRow: { flexDirection: 'row', gap: 6 },
  chip: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: '#ccc' },
  chipText: { fontSize: 13, color: '#333', textTransform: 'capitalize' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 15 },
  error: { color: '#b00020' },
});
