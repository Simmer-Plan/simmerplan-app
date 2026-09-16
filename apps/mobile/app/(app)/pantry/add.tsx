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

// Deep-link target for voice/App-Actions "add <item> to the pantry" (SIM-20):
// simmerplan://pantry/add?name=eggs. Adds the item, then routes to the pantry.
// The voice-intent-to-URL mapping is a native-build concern (SIM-39).

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../../lib/api';

export default function PantryAddDeepLink() {
  const router = useRouter();
  const { name } = useLocalSearchParams<{ name?: string }>();
  const [status, setStatus] = useState<'working' | 'done' | 'error'>('working');
  const [message, setMessage] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const item = (name ?? '').trim();
    if (!item) {
      setStatus('error');
      setMessage('No item name provided.');
      return;
    }
    api.pantry.createItem
      .mutate({ name: item })
      .then(() => {
        setStatus('done');
        setMessage(`Added “${item}” to your pantry.`);
      })
      .catch((err: unknown) => {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Failed to add item.');
      });
  }, [name]);

  return (
    <View style={styles.container}>
      {status === 'working' ? <ActivityIndicator /> : <Text style={styles.message}>{message}</Text>}
      <Button title="Open pantry" onPress={() => router.replace('/(app)/pantry')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 20, padding: 24 },
  message: { fontSize: 16, textAlign: 'center' },
});
