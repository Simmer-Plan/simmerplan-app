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

// Weekly meal planning calendar (SIM-16): a 7-day × breakfast/lunch/dinner
// grid. Tap a slot to assign a recipe (with a complexity indicator) or clear
// it, and page between weeks. Drag-and-drop and AI accept/reject (SIM-14) come
// later; shopping-list generation is SIM-17.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { DayOfWeek, MealType } from '@simmerplan/types';
import { DAYS_OF_WEEK, MEAL_TYPES } from '@simmerplan/types';
import { api } from '../../../lib/api';

type Week = Awaited<ReturnType<typeof api.mealplans.getWeek.query>>;
type Recipe = Awaited<ReturnType<typeof api.recipes.search.query>>[number];
type Suggestion = Awaited<ReturnType<typeof api.mealplans.suggest.mutate>>[number];

const DAY_LABEL: Record<DayOfWeek, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};
const COMPLEXITY_MARK: Record<string, string> = { simple: '●', moderate: '●●', complex: '●●●' };

function mondayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay(); // 0 = Sun
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return d.toISOString().slice(0, 10);
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const slotKey = (day: DayOfWeek, meal: MealType) => `${day}:${meal}`;

export default function MealPlanScreen() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [week, setWeek] = useState<Week | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ day: DayOfWeek; meal: MealType } | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggesting, setSuggesting] = useState(false);

  const complexityById = useMemo(() => {
    const m = new Map(recipes.map((r) => [r.recipeId, r.complexity]));
    return (id: string | null) => (id ? m.get(id) : undefined);
  }, [recipes]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [w, rs] = await Promise.all([
        api.mealplans.getWeek.query({ weekStartDate: weekStart }),
        api.recipes.search.query({ sort: 'name' }),
      ]);
      setWeek(w);
      setRecipes(rs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load meal plan');
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  async function assign(recipe: Recipe | null) {
    if (!selected) return;
    try {
      const next = recipe
        ? await api.mealplans.setSlot.mutate({
            weekStartDate: weekStart,
            day: selected.day,
            mealType: selected.meal,
            recipeId: recipe.recipeId,
            recipeName: recipe.name,
          })
        : await api.mealplans.clearSlot.mutate({
            weekStartDate: weekStart,
            day: selected.day,
            mealType: selected.meal,
          });
      setWeek(next);
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update slot');
    }
  }

  async function getSuggestions() {
    setSuggesting(true);
    setError(null);
    try {
      setSuggestions(await api.mealplans.suggest.mutate({ count: 3 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get suggestions');
    } finally {
      setSuggesting(false);
    }
  }

  if (loading || !week) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.weekNav}>
        <Button title="‹ Prev" onPress={() => setWeekStart((w) => addDays(w, -7))} />
        <Text style={styles.weekLabel}>Week of {weekStart}</Text>
        <Button title="Next ›" onPress={() => setWeekStart((w) => addDays(w, 7))} />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.suggestCard}>
        <Button title={suggesting ? 'Thinking…' : '✨ Get AI suggestions'} onPress={getSuggestions} disabled={suggesting} />
        {suggestions.map((s, idx) => (
          <View key={idx} style={styles.suggestion}>
            <Text style={styles.suggestionTitle}>{s.title}</Text>
            <Text style={styles.suggestionDesc}>{s.description}</Text>
            {s.usesPantryItems.length ? (
              <Text style={styles.suggestionUses}>Uses: {s.usesPantryItems.join(', ')}</Text>
            ) : null}
          </View>
        ))}
      </View>

      {DAYS_OF_WEEK.map((day, i) => (
        <View key={day} style={styles.dayCard}>
          <Text style={styles.dayHeader}>
            {DAY_LABEL[day]} · {addDays(weekStart, i)}
          </Text>
          {MEAL_TYPES.map((meal) => {
            const slot = week.slots[slotKey(day, meal)];
            const isSelected = selected?.day === day && selected?.meal === meal;
            const complexity = slot ? complexityById(slot.recipeId) : undefined;
            return (
              <Pressable
                key={meal}
                style={[styles.slot, isSelected && styles.slotSelected]}
                onPress={() => setSelected(isSelected ? null : { day, meal })}
              >
                <Text style={styles.mealLabel}>{meal}</Text>
                <Text style={styles.slotValue}>
                  {slot?.recipeName || slot?.note || <Text style={styles.slotEmpty}>tap to plan</Text>}
                </Text>
                {complexity ? <Text style={styles.complexity}>{COMPLEXITY_MARK[complexity]}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ))}

      {selected ? (
        <View style={styles.picker}>
          <Text style={styles.pickerTitle}>
            Plan {selected.meal} · {DAY_LABEL[selected.day]}
          </Text>
          <Button title="Clear slot" color="#b00020" onPress={() => assign(null)} />
          {recipes.length === 0 ? <Text style={styles.slotEmpty}>No recipes yet — add some first.</Text> : null}
          {recipes.map((r) => (
            <Pressable key={r.recipeId} style={styles.pickerRow} onPress={() => assign(r)}>
              <Text style={styles.pickerName}>{r.name}</Text>
              <Text style={styles.complexity}>{COMPLEXITY_MARK[r.complexity]}</Text>
            </Pressable>
          ))}
          <Button title="Cancel" onPress={() => setSelected(null)} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  weekNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  weekLabel: { fontSize: 16, fontWeight: '600' },
  dayCard: { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 10, padding: 10, gap: 6 },
  dayHeader: { fontSize: 15, fontWeight: '600' },
  slot: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8, backgroundColor: '#f6f6f6' },
  slotSelected: { backgroundColor: '#dff0e6', borderWidth: 1, borderColor: '#2a6' },
  mealLabel: { width: 78, fontSize: 13, color: '#666', textTransform: 'capitalize' },
  slotValue: { flex: 1, fontSize: 15 },
  slotEmpty: { color: '#aaa', fontStyle: 'italic' },
  complexity: { fontSize: 12, color: '#2a6' },
  picker: { borderWidth: 1, borderColor: '#2a6', borderRadius: 10, padding: 12, gap: 8 },
  pickerTitle: { fontSize: 16, fontWeight: '600', textTransform: 'capitalize' },
  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  pickerName: { fontSize: 15 },
  error: { color: '#b00020' },
  suggestCard: { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 10, padding: 12, gap: 10 },
  suggestion: { gap: 2, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  suggestionTitle: { fontSize: 15, fontWeight: '600' },
  suggestionDesc: { fontSize: 14, color: '#444' },
  suggestionUses: { fontSize: 12, color: '#2a6' },
});
