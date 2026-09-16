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

The app is a **managed Expo workflow**. `@react-native-google-signin` does not work
in Expo Go, so on-device Google Sign-In requires an EAS **development build**, and
the build's signing certificate must be registered in the Google Cloud OAuth client.

Everything that can be prepared in code **is already done** — `eas.json` profiles,
`expo-dev-client`, the `EXPO_PUBLIC_*` values, `iosUrlScheme`. What remains needs a
human with an Expo account.

## Start with Android

The dev box is WSL2. iOS builds need either a paid **Apple Developer Program**
membership ($99/yr, for device builds) or a **macOS machine** (for a free simulator
build) — neither is available here. Android needs **no paid account**. Do Android
first; it exercises the identical auth path.

---

## Step 1 — Expo account + CLI

```bash
npm i -g eas-cli
eas login            # create the account at https://expo.dev/signup if needed
eas whoami
```

## Step 2 — Link the project

```bash
cd ~/Projects/simmerplan-app/apps/mobile
eas init
```

This replaces the **placeholder** `expo.extra.eas.projectId` in `app.json`
(`00000000-0000-0000-0000-000000000000`) with the real id. **Commit that change.**

If you build under an Expo **organisation** rather than your personal account, also
add `"owner": "<org-slug>"` under `expo` in `app.json`.

## Step 3 — First Android build

```bash
eas build --profile development --platform android
```

EAS will offer to **generate a new Android keystore** — accept; let EAS manage it.
The build takes ~10–20 min and ends with a download URL / QR code for the `.apk`.

> **If the build fails resolving modules** (`Unable to resolve module …`), it is
> almost certainly pnpm's symlinked `node_modules` vs. Metro. Add an `.npmrc` at the
> repo root containing `node-linker=hoisted`, commit, and rebuild. RN 0.76 handles
> symlinks better than older versions, so try without it first.

## Step 4 — Register the EAS keystore's SHA-1 in Google Cloud

```bash
eas credentials          # -> Android -> production/development -> Keystore
```

Copy the **SHA-1 Fingerprint**, then in Google Cloud Console → **Credentials** →
the existing **Android** OAuth client (`com.simmerplan.app`), add it as an
additional SHA-1.

The client currently holds only the **local debug keystore** SHA-1
(`9E:E7:4C:B4:B5:0E:7E:14:E3:3B:8A:72:71:0F:D9:85:1F:82:72:76`), which is valid for
local debug builds from this machine only. An Android OAuth client accepts
**multiple** SHA-1s — add, don't replace.

Without this step the app installs fine but Google Sign-In fails with
`DEVELOPER_ERROR`.

## Step 5 — Install and test

Install the `.apk` on a device (or an Android emulator), then:

```bash
cd ~/Projects/simmerplan-app/apps/mobile
pnpm start            # dev server; the dev build connects to it
```

Verify end-to-end:
1. **Sign in with Google** → should return to the app signed in.
2. First sign-in has no household → the household-setup screen; create one.
3. Pantry / Recipes / Shopping list / Schedule screens should read and write against
   the sandbox API (already deployed and verified server-side).
4. Meal suggestions need Bedrock, which is pending an AWS account verification —
   expect that one screen to error until that clears.

That closes the on-device half of SIM-29 and completes SIM-39's Android track.

---

## iOS (later)

- **Device build** → requires the paid Apple Developer Program. `eas build --profile
  development --platform ios` then `eas credentials` to let EAS manage the
  distribution cert + provisioning profile.
- **Simulator build** (free, no paid account) → needs macOS to run the simulator.
- Confirm the bundle identifier `com.simmerplan.app` matches the Google **iOS** OAuth
  client. `iosUrlScheme` is already set in `app.json`.

## Already prepared in code — do not redo

| Item | State |
|---|---|
| `eas.json` profiles (`development` / `preview` / `production`) | present |
| `expo-dev-client` | added (required by `developmentClient: true`) |
| `EXPO_PUBLIC_*` for cloud builds | baked into the `development` + `preview` profiles' `env` — **`.env` is gitignored so EAS never sees it**, which would otherwise ship an app with undefined Google client IDs and a blank API URL |
| `iosUrlScheme` (reversed iOS client id) | set in `app.json` |
| Android / iOS OAuth clients | created in Google Cloud |

⚠️ The `production` profile has **no `env`** on purpose — it needs the *prod* API URL
and *prod* Google OAuth client IDs, which do not exist yet.

## Later: Play Store

When publishing, Google re-signs uploads with its own key — add the **Play App
Signing** SHA-1 to the Android OAuth client as well.
