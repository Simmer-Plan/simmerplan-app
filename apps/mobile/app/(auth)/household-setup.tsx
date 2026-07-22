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

// Household create/join stub (SIM-29) — first-run screen for a signed-in user
// with no household. Styling deferred to Phase 2. A `token` param (from a
// simmerplan.com/join invite link) pre-fills the join field.

import { useState } from 'react';
import {
  ActivityIndicator,
  Button,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { createHousehold, joinHousehold } from '../../lib/auth';

export default function HouseholdSetupScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const [name, setName] = useState('');
  const [inviteToken, setInviteToken] = useState(params.token ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      router.replace('/(app)');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (busy) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Set up your household</Text>

      <View style={styles.section}>
        <Text style={styles.label}>Create a new household</Text>
        <TextInput
          style={styles.input}
          placeholder="Household name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />
        <Button
          title="Create household"
          disabled={!name.trim()}
          onPress={() => run(() => createHousehold(name.trim()))}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Join with an invite</Text>
        <TextInput
          style={styles.input}
          placeholder="Invite token"
          value={inviteToken}
          onChangeText={setInviteToken}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button
          title="Join household"
          disabled={!inviteToken.trim()}
          onPress={() => run(() => joinHousehold(inviteToken.trim()))}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', gap: 28, padding: 24 },
  title: { fontSize: 24, fontWeight: '600', textAlign: 'center' },
  section: { gap: 10 },
  label: { fontSize: 16, fontWeight: '500' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16 },
  error: { color: '#b00020', textAlign: 'center' },
});
