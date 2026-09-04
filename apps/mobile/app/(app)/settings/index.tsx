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

// Profile & account settings (SIM-21): edit display name, notification
// preferences, view/manage household members + invites, and sign out. Email is
// the read-only Google identity (no editable password with Google sign-in).
// Connected services and data export/deletion are placeholders — see the notes.

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../../lib/api';
import { signOut } from '../../../lib/auth';

type Profile = Awaited<ReturnType<typeof api.profile.get.query>>;
type Household = Awaited<ReturnType<typeof api.household.get.query>>;

export default function SettingsScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const prof = await api.profile.get.query();
      setProfile(prof);
      setName(prof.name);
      // Household is optional — a user may not have one yet.
      try {
        setHousehold(await api.household.get.query());
      } catch {
        setHousehold(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveName() {
    if (!name.trim() || name.trim() === profile?.name) return;
    setSavingName(true);
    try {
      setProfile(await api.profile.updateName.mutate({ name: name.trim() }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save name');
    } finally {
      setSavingName(false);
    }
  }

  async function setPref(patch: { weeklyPlanReminder?: boolean; expiryAlerts?: boolean }) {
    if (!profile) return;
    const next = { ...profile.preferences, ...patch };
    setProfile({ ...profile, preferences: next });
    try {
      await api.profile.updatePreferences.mutate(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save preferences');
      await load();
    }
  }

  async function createInvite() {
    try {
      const res = await api.household.invite.mutate();
      setInviteUrl(res.inviteUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invite');
    }
  }

  async function doSignOut() {
    await signOut();
    router.replace('/(auth)/sign-in');
  }

  function notAvailable(feature: string) {
    Alert.alert(feature, 'Not available yet — planned for a later phase.');
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
      <Text style={styles.title}>Settings</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Section title="Profile">
        <Text style={styles.label}>Display name</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} autoCapitalize="words" />
        <Button title="Save name" onPress={saveName} disabled={savingName || !name.trim() || name.trim() === profile?.name} />
        <Text style={styles.label}>Email (from Google)</Text>
        <Text style={styles.readonly}>{profile?.email}</Text>
        <Text style={styles.hint}>Email and password are managed by Google Sign-In.</Text>
      </Section>

      <Section title="Notifications">
        <ToggleRow
          label="Weekly plan reminder"
          value={profile?.preferences.weeklyPlanReminder ?? false}
          onValueChange={(v) => setPref({ weeklyPlanReminder: v })}
        />
        <ToggleRow
          label="Expiry alerts"
          value={profile?.preferences.expiryAlerts ?? false}
          onValueChange={(v) => setPref({ expiryAlerts: v })}
        />
        <Text style={styles.hint}>Delivery is enabled once push notifications ship (Phase 4).</Text>
      </Section>

      <Section title="Household">
        {household ? (
          <>
            <Text style={styles.readonly}>{household.name}</Text>
            {household.members.map((m) => (
              <Text key={m.userId} style={styles.member}>
                {m.name} · {m.role ?? 'member'}
                {m.userId === profile?.userId ? ' (you)' : ''}
              </Text>
            ))}
            {profile?.role === 'owner' ? <Button title="Create invite" onPress={createInvite} /> : null}
            {inviteUrl ? <Text style={styles.invite} selectable>{inviteUrl}</Text> : null}
          </>
        ) : (
          <Text style={styles.hint}>You are not in a household yet.</Text>
        )}
      </Section>

      <Section title="Connected services">
        <Text style={styles.hint}>Google Home and Google Calendar integrations are coming in Phase 4.</Text>
      </Section>

      <Section title="Data & account">
        <Button title="Export my data" onPress={() => notAvailable('Data export')} />
        <View style={styles.spacer} />
        <Button title="Delete account" color="#b00020" onPress={() => notAvailable('Account deletion')} />
        <Text style={styles.hint}>Export and deletion are not implemented yet (need careful data handling).</Text>
      </Section>

      <View style={styles.signOut}>
        <Button title="Sign out" onPress={doSignOut} />
      </View>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ToggleRow({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '600' },
  section: { gap: 8, padding: 12, borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '600' },
  label: { fontSize: 14, fontWeight: '500', marginTop: 4 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 15 },
  readonly: { fontSize: 15, color: '#333' },
  member: { fontSize: 14, color: '#444' },
  hint: { fontSize: 12, color: '#888' },
  invite: { fontSize: 12, color: '#2a6', marginTop: 4 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleLabel: { fontSize: 15 },
  spacer: { height: 8 },
  signOut: { marginTop: 8, marginBottom: 32 },
  error: { color: '#b00020' },
});
