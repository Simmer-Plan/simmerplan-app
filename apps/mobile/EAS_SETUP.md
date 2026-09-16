<!--
Copyright 2026 Dave LeBlanc

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->

# EAS Cloud builds & signing (SIM-39)

The mobile app is a **managed Expo workflow** with no native `android/`/`ios/`
dirs. `@react-native-google-signin` does not work in Expo Go, so on-device
Google Sign-In requires an EAS **development build**, and the build's signing
certificate must be registered in the Google Cloud OAuth clients.

`eas.json` already defines the three build profiles (`development`, `preview`,
`production`). The steps below still require a human with an Expo account — they
are **not yet done** and are the remaining SIM-39 tasks.

## ⚠️ Placeholder values to replace

| File | Key | Placeholder | Replace via |
|---|---|---|---|
| `app.json` | `expo.extra.eas.projectId` | `00000000-0000-0000-0000-000000000000` | `eas init` (writes the real project id) |
| `app.json` | `expo.owner` (add if using an org) | _absent_ | your Expo account/org slug |

## Manual steps (need an Expo account)

```bash
npm i -g eas-cli
eas login
cd apps/mobile
eas init            # creates the EAS project, replaces the placeholder projectId

# Android keystore (EAS-managed) — capture its SHA-1:
eas credentials     # → Android → Keystore → SHA-1 Fingerprint

# First development builds:
eas build --profile development --platform android
eas build --profile development --platform ios
```

## Register the EAS Android SHA-1 in Google Cloud

The **sandbox** Google Android OAuth client currently has only the local debug
keystore SHA-1 (`9E:E7:4C:B4:B5:0E:7E:14:E3:3B:8A:72:71:0F:D9:85:1F:82:72:76`,
valid for local debug builds only). Add the **EAS-managed** SHA-1 alongside it
(an Android OAuth client accepts multiple SHA-1s). Package name: `com.simmerplan.app`.

When publishing to Play, also add the **Play App Signing** SHA-1 (Google
re-signs uploads).

## iOS

EAS manages the distribution certificate + provisioning profile. Confirm the
bundle identifier `com.simmerplan.app` matches the Google iOS OAuth client.

## Validation

After the first development build installs on a device/simulator, run the app
and complete Google Sign-In end-to-end — that closes the on-device half of the
auth flow (server side is already validated under SIM-29).
