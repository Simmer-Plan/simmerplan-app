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

// Recipe creation/editing screen (SIM-11): name, description, ingredients
// (optionally linked to pantry items), step-by-step instructions, prep/cook
// time, complexity and tags. Minimal Phase 2 styling.

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { QuantityUnit, RecipeComplexity } from '@simmerplan/types';
import { api } from '../../../lib/api';

type Recipe = Awaited<ReturnType<typeof api.recipes.list.query>>[number];
type PantryItem = Awaited<ReturnType<typeof api.pantry.listItems.query>>[number];

type IngredientRow = { name: string; quantity: string; unit: QuantityUnit; pantryItemId: string | null };

const UNITS: QuantityUnit[] = ['count', 'lb', 'oz', 'g', 'kg', 'ml', 'l', 'cup', 'tbsp', 'tsp'];
const COMPLEXITY: RecipeComplexity[] = ['simple', 'moderate', 'complex'];

const emptyForm = {
  name: '',
  description: '',
  complexity: 'simple' as RecipeComplexity,
  prepTimeMinutes: '',
  cookTimeMinutes: '',
  tags: '',
  ingredients: [] as IngredientRow[],
  instructions: [] as string[],
};

export default function RecipesScreen() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [pantry, setPantry] = useState<PantryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [rs, ps] = await Promise.all([api.recipes.list.query(), api.pantry.listItems.query()]);
      setRecipes(rs);
      setPantry(ps);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load recipes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  function editRecipe(r: Recipe) {
    setEditingId(r.recipeId);
    setForm({
      name: r.name,
      description: r.description,
      complexity: r.complexity,
      prepTimeMinutes: r.prepTimeMinutes != null ? String(r.prepTimeMinutes) : '',
      cookTimeMinutes: r.cookTimeMinutes != null ? String(r.cookTimeMinutes) : '',
      tags: r.tags.join(', '),
      ingredients: r.ingredients.map((i) => ({
        name: i.name,
        quantity: i.quantity != null ? String(i.quantity) : '',
        unit: i.unit ?? 'count',
        pantryItemId: i.pantryItemId,
      })),
      instructions: [...r.instructions],
    });
  }

  async function submit() {
    if (!form.name.trim()) return;
    setSaving(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      photoUrl: null,
      complexity: form.complexity,
      prepTimeMinutes: form.prepTimeMinutes ? Number(form.prepTimeMinutes) : null,
      cookTimeMinutes: form.cookTimeMinutes ? Number(form.cookTimeMinutes) : null,
      tags: form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      ingredients: form.ingredients
        .filter((i) => i.name.trim())
        .map((i) => ({
          name: i.name.trim(),
          quantity: i.quantity ? Number(i.quantity) : null,
          unit: i.unit,
          pantryItemId: i.pantryItemId,
        })),
      instructions: form.instructions.map((s) => s.trim()).filter(Boolean),
    };
    try {
      if (editingId) {
        await api.recipes.update.mutate({ recipeId: editingId, ...payload });
      } else {
        await api.recipes.create.mutate(payload);
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save recipe');
    } finally {
      setSaving(false);
    }
  }

  async function remove(recipeId: string) {
    try {
      await api.recipes.delete.mutate({ recipeId });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete recipe');
    }
  }

  function setIngredient(idx: number, patch: Partial<IngredientRow>) {
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.map((row, i) => (i === idx ? { ...row, ...patch } : row)),
    }));
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={recipes}
      keyExtractor={(r) => r.recipeId}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title}>Recipes</Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{editingId ? 'Edit recipe' : 'New recipe'}</Text>
            <TextInput
              style={styles.input}
              placeholder="Recipe name"
              value={form.name}
              onChangeText={(name) => setForm((f) => ({ ...f, name }))}
            />
            <TextInput
              style={[styles.input, styles.multiline]}
              placeholder="Description"
              value={form.description}
              onChangeText={(description) => setForm((f) => ({ ...f, description }))}
              multiline
            />

            <Text style={styles.label}>Complexity</Text>
            <View style={styles.chipRow}>
              {COMPLEXITY.map((c) => (
                <Chip key={c} label={c} active={form.complexity === c} onPress={() => setForm((f) => ({ ...f, complexity: c }))} />
              ))}
            </View>

            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.flex1]}
                placeholder="Prep (min)"
                value={form.prepTimeMinutes}
                onChangeText={(prepTimeMinutes) => setForm((f) => ({ ...f, prepTimeMinutes }))}
                keyboardType="numeric"
              />
              <TextInput
                style={[styles.input, styles.flex1]}
                placeholder="Cook (min)"
                value={form.cookTimeMinutes}
                onChangeText={(cookTimeMinutes) => setForm((f) => ({ ...f, cookTimeMinutes }))}
                keyboardType="numeric"
              />
            </View>

            <TextInput
              style={styles.input}
              placeholder="Tags (comma separated)"
              value={form.tags}
              onChangeText={(tags) => setForm((f) => ({ ...f, tags }))}
              autoCapitalize="none"
            />

            <Text style={styles.label}>Ingredients</Text>
            {form.ingredients.map((ing, idx) => (
              <View key={idx} style={styles.ingredientBlock}>
                <View style={styles.row}>
                  <TextInput
                    style={[styles.input, styles.flex1]}
                    placeholder="Ingredient"
                    value={ing.name}
                    onChangeText={(name) => setIngredient(idx, { name })}
                  />
                  <TextInput
                    style={[styles.input, styles.qty]}
                    placeholder="Qty"
                    value={ing.quantity}
                    onChangeText={(quantity) => setIngredient(idx, { quantity })}
                    keyboardType="numeric"
                  />
                  <Button title="✕" color="#b00020" onPress={() =>
                    setForm((f) => ({ ...f, ingredients: f.ingredients.filter((_, i) => i !== idx) }))
                  } />
                </View>
                <View style={styles.chipRow}>
                  {UNITS.map((u) => (
                    <Chip key={u} label={u} active={ing.unit === u} onPress={() => setIngredient(idx, { unit: u })} />
                  ))}
                </View>
                {pantry.length ? (
                  <View style={styles.chipRow}>
                    <Chip label="No link" active={ing.pantryItemId === null} onPress={() => setIngredient(idx, { pantryItemId: null })} />
                    {pantry.map((p) => (
                      <Chip
                        key={p.itemId}
                        label={p.name}
                        active={ing.pantryItemId === p.itemId}
                        onPress={() => setIngredient(idx, { pantryItemId: p.itemId, name: ing.name || p.name })}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            ))}
            <Button
              title="+ Add ingredient"
              onPress={() =>
                setForm((f) => ({ ...f, ingredients: [...f.ingredients, { name: '', quantity: '', unit: 'count', pantryItemId: null }] }))
              }
            />

            <Text style={styles.label}>Instructions</Text>
            {form.instructions.map((step, idx) => (
              <View key={idx} style={styles.row}>
                <Text style={styles.stepNum}>{idx + 1}.</Text>
                <TextInput
                  style={[styles.input, styles.flex1]}
                  placeholder={`Step ${idx + 1}`}
                  value={step}
                  onChangeText={(text) =>
                    setForm((f) => ({ ...f, instructions: f.instructions.map((s, i) => (i === idx ? text : s)) }))
                  }
                  multiline
                />
                <Button title="✕" color="#b00020" onPress={() =>
                  setForm((f) => ({ ...f, instructions: f.instructions.filter((_, i) => i !== idx) }))
                } />
              </View>
            ))}
            <Button title="+ Add step" onPress={() => setForm((f) => ({ ...f, instructions: [...f.instructions, ''] }))} />

            <View style={styles.row}>
              <Button title={editingId ? 'Save recipe' : 'Create recipe'} onPress={submit} disabled={saving || !form.name.trim()} />
              {editingId ? <Button title="Cancel" onPress={resetForm} /> : null}
            </View>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Text style={styles.sectionTitle}>Recipes ({recipes.length})</Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.item}>
          <View style={styles.flex1}>
            <Text style={styles.itemName}>{item.name}</Text>
            <Text style={styles.itemMeta}>
              {item.complexity}
              {item.prepTimeMinutes != null || item.cookTimeMinutes != null
                ? ` · ${(item.prepTimeMinutes ?? 0) + (item.cookTimeMinutes ?? 0)} min`
                : ''}
              {item.ingredients.length ? ` · ${item.ingredients.length} ingredients` : ''}
            </Text>
            {item.tags.length ? <Text style={styles.itemTags}>{item.tags.join(' · ')}</Text> : null}
          </View>
          <Button title="Edit" onPress={() => editRecipe(item)} />
          <Button title="Delete" color="#b00020" onPress={() => remove(item.recipeId)} />
        </View>
      )}
      ListEmptyComponent={<Text style={styles.empty}>No recipes yet.</Text>}
    />
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { gap: 12, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: '600' },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginTop: 4 },
  card: { gap: 8, padding: 12, borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 10 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  label: { fontSize: 14, fontWeight: '500', marginTop: 4 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 15 },
  multiline: { minHeight: 60, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  flex1: { flex: 1 },
  qty: { width: 64 },
  ingredientBlock: { gap: 6, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  stepNum: { fontSize: 15, fontWeight: '600', width: 22 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: '#ccc' },
  chipActive: { backgroundColor: '#2a6', borderColor: '#2a6' },
  chipText: { fontSize: 13, color: '#333' },
  chipTextActive: { color: '#fff' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  itemName: { fontSize: 16, fontWeight: '500' },
  itemMeta: { fontSize: 13, color: '#666' },
  itemTags: { fontSize: 12, color: '#2a6' },
  empty: { textAlign: 'center', color: '#888', paddingVertical: 24 },
  error: { color: '#b00020' },
});
