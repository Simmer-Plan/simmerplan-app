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

// Pantry item CRUD screen (SIM-9): add/edit/delete items, assign a storage
// location, set quantity + unit and an optional expiry, and search/filter by
// location. Styling is intentionally minimal — Phase 2 baseline.

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import type { QuantityUnit, StorageLocationKind } from '@simmerplan/types';
import { api } from '../../../lib/api';

type PantryItem = Awaited<ReturnType<typeof api.pantry.listItems.query>>[number];
type StorageLocation = Awaited<ReturnType<typeof api.pantry.listLocations.query>>[number];

const UNITS: QuantityUnit[] = ['count', 'lb', 'oz', 'g', 'kg', 'ml', 'l', 'cup', 'tbsp', 'tsp'];
const LOCATION_KINDS: StorageLocationKind[] = ['cupboard', 'fridge', 'freezer', 'pantry', 'custom'];

const emptyForm = { name: '', quantity: '1', unit: 'count' as QuantityUnit, locationId: null as string | null, expiryDate: '' };

export default function PantryScreen() {
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [items, setItems] = useState<PantryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [filterLocationId, setFilterLocationId] = useState<string | null>(null);

  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationKind, setNewLocationKind] = useState<StorageLocationKind>('pantry');

  // Barcode lookup (SIM-10).
  const [barcode, setBarcode] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [barcodeMsg, setBarcodeMsg] = useState<string | null>(null);

  const locationName = useMemo(() => {
    const map = new Map(locations.map((l) => [l.locationId, l.name]));
    return (id: string | null) => (id ? (map.get(id) ?? 'Unknown') : 'Unassigned');
  }, [locations]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [locs, its] = await Promise.all([
        api.pantry.listLocations.query(),
        api.pantry.listItems.query({
          locationId: filterLocationId ?? undefined,
          search: search.trim() || undefined,
        }),
      ]);
      setLocations(locs);
      setItems(its);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pantry');
    } finally {
      setLoading(false);
    }
  }, [filterLocationId, search]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  async function submitItem() {
    if (!form.name.trim()) return;
    setSaving(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      quantity: Number(form.quantity) || 0,
      unit: form.unit,
      locationId: form.locationId,
      expiryDate: form.expiryDate.trim() || null,
    };
    try {
      if (editingId) {
        await api.pantry.updateItem.mutate({ itemId: editingId, ...payload });
      } else {
        await api.pantry.createItem.mutate(payload);
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save item');
    } finally {
      setSaving(false);
    }
  }

  function editItem(item: PantryItem) {
    setEditingId(item.itemId);
    setForm({
      name: item.name,
      quantity: String(item.quantity),
      unit: item.unit,
      locationId: item.locationId,
      expiryDate: item.expiryDate ?? '',
    });
  }

  async function deleteItem(itemId: string) {
    setError(null);
    try {
      await api.pantry.deleteItem.mutate({ itemId });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete item');
    }
  }

  async function lookupBarcode() {
    if (!barcode.trim()) return;
    setLookingUp(true);
    setError(null);
    setBarcodeMsg(null);
    try {
      const res = await api.pantry.lookupBarcode.query({ barcode: barcode.trim() });
      if (!res.found) {
        setBarcodeMsg('No product found for that barcode.');
        return;
      }
      const loc = locations.find((l) => l.kind === res.suggestedLocationKind);
      setForm((f) => ({
        ...f,
        name: res.name ?? f.name,
        locationId: loc ? loc.locationId : f.locationId,
      }));
      setBarcodeMsg(
        `Found: ${res.name ?? 'unknown'}${res.brand ? ` (${res.brand})` : ''} · suggested ${res.suggestedLocationKind}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Barcode lookup failed');
    } finally {
      setLookingUp(false);
    }
  }

  async function addLocation() {
    if (!newLocationName.trim()) return;
    try {
      await api.pantry.createLocation.mutate({ name: newLocationName.trim(), kind: newLocationKind });
      setNewLocationName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add location');
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
    <FlatList
      style={styles.container}
      data={items}
      keyExtractor={(i) => i.itemId}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title}>Pantry</Text>

          <TextInput
            style={styles.input}
            placeholder="Search items"
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
          />

          <View style={styles.chipRow}>
            <Chip label="All" active={filterLocationId === null} onPress={() => setFilterLocationId(null)} />
            {locations.map((l) => (
              <Chip
                key={l.locationId}
                label={l.name}
                active={filterLocationId === l.locationId}
                onPress={() => setFilterLocationId(l.locationId)}
              />
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Add by barcode</Text>
            <TextInput
              style={styles.input}
              placeholder="Barcode / UPC"
              value={barcode}
              onChangeText={setBarcode}
              keyboardType="numeric"
            />
            <Button title={lookingUp ? 'Looking up…' : 'Look up'} onPress={lookupBarcode} disabled={lookingUp || !barcode.trim()} />
            {barcodeMsg ? <Text style={styles.hint}>{barcodeMsg}</Text> : null}
            <Text style={styles.hint}>
              Camera scanning needs a dev build (expo-camera); for now enter the code — a match
              fills the item form below.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{editingId ? 'Edit item' : 'Add item'}</Text>
            <TextInput
              style={styles.input}
              placeholder="Item name"
              value={form.name}
              onChangeText={(name) => setForm((f) => ({ ...f, name }))}
            />
            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.flex1]}
                placeholder="Qty"
                value={form.quantity}
                onChangeText={(quantity) => setForm((f) => ({ ...f, quantity }))}
                keyboardType="numeric"
              />
              <View style={styles.chipRowFlex}>
                {UNITS.map((u) => (
                  <Chip key={u} label={u} active={form.unit === u} onPress={() => setForm((f) => ({ ...f, unit: u }))} />
                ))}
              </View>
            </View>
            <Text style={styles.label}>Location</Text>
            <View style={styles.chipRow}>
              <Chip
                label="Unassigned"
                active={form.locationId === null}
                onPress={() => setForm((f) => ({ ...f, locationId: null }))}
              />
              {locations.map((l) => (
                <Chip
                  key={l.locationId}
                  label={l.name}
                  active={form.locationId === l.locationId}
                  onPress={() => setForm((f) => ({ ...f, locationId: l.locationId }))}
                />
              ))}
            </View>
            <TextInput
              style={styles.input}
              placeholder="Expiry (YYYY-MM-DD, optional)"
              value={form.expiryDate}
              onChangeText={(expiryDate) => setForm((f) => ({ ...f, expiryDate }))}
              autoCapitalize="none"
            />
            <View style={styles.row}>
              <Button title={editingId ? 'Save' : 'Add'} onPress={submitItem} disabled={saving || !form.name.trim()} />
              {editingId ? <Button title="Cancel" onPress={resetForm} /> : null}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Add storage location</Text>
            <TextInput
              style={styles.input}
              placeholder="Location name"
              value={newLocationName}
              onChangeText={setNewLocationName}
            />
            <View style={styles.chipRow}>
              {LOCATION_KINDS.map((k) => (
                <Chip key={k} label={k} active={newLocationKind === k} onPress={() => setNewLocationKind(k)} />
              ))}
            </View>
            <Button title="Add location" onPress={addLocation} disabled={!newLocationName.trim()} />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Text style={styles.sectionTitle}>Items ({items.length})</Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.item}>
          <View style={styles.flex1}>
            <Text style={styles.itemName}>{item.name}</Text>
            <Text style={styles.itemMeta}>
              {item.quantity} {item.unit} · {locationName(item.locationId)}
              {item.expiryDate ? ` · exp ${item.expiryDate}` : ''}
            </Text>
          </View>
          <Button title="Edit" onPress={() => editItem(item)} />
          <Button title="Delete" color="#b00020" onPress={() => deleteItem(item.itemId)} />
        </View>
      )}
      ListEmptyComponent={<Text style={styles.empty}>No pantry items yet.</Text>}
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
  label: { fontSize: 14, fontWeight: '500' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 15 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  flex1: { flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chipRowFlex: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 2 },
  chip: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: '#ccc' },
  chipActive: { backgroundColor: '#2a6', borderColor: '#2a6' },
  chipText: { fontSize: 13, color: '#333' },
  chipTextActive: { color: '#fff' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  itemName: { fontSize: 16, fontWeight: '500' },
  itemMeta: { fontSize: 13, color: '#666' },
  empty: { textAlign: 'center', color: '#888', paddingVertical: 24 },
  error: { color: '#b00020' },
  hint: { fontSize: 12, color: '#888' },
});
