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

// Sign-in screen stub (SIM-29) — styling deferred to Phase 2.

import { useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { householdIdFromIdToken, signInWithGoogle } from '../../lib/auth';

export default function SignInScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSignIn() {
    setBusy(true);
    setError(null);
    try {
      const { cognitoTokens, user, isNewUser } = await signInWithGoogle();
      const householdId = householdIdFromIdToken(cognitoTokens.idToken) ?? user.householdId;
      if (isNewUser || !householdId) {
        router.replace('/(auth)/household-setup');
      } else {
        router.replace('/(app)');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Simmerplan</Text>
      {busy ? <ActivityIndicator /> : <Button title="Sign in with Google" onPress={onSignIn} />}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  title: { fontSize: 28, fontWeight: '600' },
  error: { color: '#b00020', paddingHorizontal: 24, textAlign: 'center' },
});
