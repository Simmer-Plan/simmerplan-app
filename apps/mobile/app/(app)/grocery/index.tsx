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

// Shopping list (SIM-17): auto-generate from the current week's plan (recipe
// ingredients minus pantry stock), add items manually, tick them off, share as
// text, and push purchased items into the pantry. Google Keep export is a later
// integration.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '../../../lib/api';

type GroceryItem = Awaited<ReturnType<typeof api.grocery.list.query>>[number];

function mondayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return d.toISOString().slice(0, 10);
}

export default function GroceryScreen() {
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await api.grocery.list.query());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load list');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const bySection = useMemo(() => {
    const groups = new Map<string, GroceryItem[]>();
    for (const item of items) {
      const list = groups.get(item.section) ?? [];
      list.push(item);
      groups.set(item.section, list);
    }
    return [...groups.entries()];
  }, [items]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      setItems(await api.grocery.generateFromWeek.mutate({ weekStartDate: mondayOf(new Date()) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate list');
    } finally {
      setBusy(false);
    }
  }

  async function addManual() {
    if (!newName.trim()) return;
    try {
      await api.grocery.addItem.mutate({ name: newName.trim() });
      setNewName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add item');
    }
  }

  async function toggle(item: GroceryItem) {
    setItems((prev) => prev.map((i) => (i.groceryItemId === item.groceryItemId ? { ...i, checked: !i.checked } : i)));
    try {
      await api.grocery.toggleItem.mutate({ groceryItemId: item.groceryItemId, checked: !item.checked });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update item');
      await load();
    }
  }

  async function remove(item: GroceryItem) {
    try {
      await api.grocery.deleteItem.mutate({ groceryItemId: item.groceryItemId });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete item');
    }
  }

  async function purchase() {
    setBusy(true);
    try {
      setItems(await api.grocery.purchaseChecked.mutate());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update pantry');
    } finally {
      setBusy(false);
    }
  }

  async function shareText() {
    const text = bySection
      .map(([section, list]) => `${section.toUpperCase()}\n${list.map((i) => `- ${i.name}`).join('\n')}`)
      .join('\n\n');
    if (text) await Share.share({ message: text }).catch(() => undefined);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  const checkedCount = items.filter((i) => i.checked).length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Shopping list</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        <Button title={busy ? 'Working…' : 'Generate from this week'} onPress={generate} disabled={busy} />
        <Button title="Share" onPress={shareText} disabled={items.length === 0} />
      </View>

      <View style={styles.addRow}>
        <TextInput style={[styles.input, styles.flex1]} placeholder="Add an item" value={newName} onChangeText={setNewName} />
        <Button title="Add" onPress={addManual} disabled={!newName.trim()} />
      </View>

      {items.length === 0 ? <Text style={styles.empty}>List is empty. Generate from your plan or add items.</Text> : null}

      {bySection.map(([section, list]) => (
        <View key={section} style={styles.section}>
          <Text style={styles.sectionTitle}>{section}</Text>
          {list.map((item) => (
            <View key={item.groceryItemId} style={styles.item}>
              <Pressable style={styles.checkArea} onPress={() => toggle(item)}>
                <Text style={styles.checkbox}>{item.checked ? '☑' : '☐'}</Text>
                <Text style={[styles.itemName, item.checked && styles.itemChecked]}>{item.name}</Text>
                {item.source === 'auto' ? <Text style={styles.autoTag}>plan</Text> : null}
              </Pressable>
              <Text style={styles.removeLink} onPress={() => remove(item)}>
                ✕
              </Text>
            </View>
          ))}
        </View>
      ))}

      {checkedCount > 0 ? (
        <View style={styles.purchase}>
          <Button title={`Add ${checkedCount} purchased to pantry`} onPress={purchase} disabled={busy} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8 },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 15 },
  flex1: { flex: 1 },
  section: { gap: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#2a6', textTransform: 'capitalize' },
  item: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  checkArea: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  checkbox: { fontSize: 18 },
  itemName: { fontSize: 15 },
  itemChecked: { textDecorationLine: 'line-through', color: '#999' },
  autoTag: { fontSize: 11, color: '#888' },
  removeLink: { fontSize: 16, color: '#b00020', paddingHorizontal: 8 },
  empty: { textAlign: 'center', color: '#888', paddingVertical: 24 },
  purchase: { marginTop: 8, marginBottom: 32 },
  error: { color: '#b00020' },
});
