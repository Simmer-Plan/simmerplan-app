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

# Voice commands via App Actions / App Intents (SIM-20)

Follows the SIM-7 decision: no Conversational Actions. Voice runs through **App
Actions (Android)** and **App Intents / Siri Shortcuts (iOS)** that deep-link into
the app and call existing tRPC endpoints.

## What shipped in this PR (works now, via the custom scheme)

Deep-link handler routes (Expo Router):

| Deep link | Route | Action |
|---|---|---|
| `simmerplan://grocery/add?name=<item>` | `app/(app)/grocery/add.tsx` | `grocery.addItem` → open shopping list |
| `simmerplan://pantry/add?name=<item>` | `app/(app)/pantry/add.tsx` | `pantry.createItem` → open pantry |

Both are reachable today through the registered `simmerplan://` scheme (test with
`npx uri-scheme open "simmerplan://grocery/add?name=milk" --android` on a dev build).

## What's still required (native build — blocked on SIM-39)

App Actions / App Intents cannot be expressed from the managed Expo config alone;
they need generated native files, so they land with the EAS dev-build work (SIM-39):

- **Android** — an `android/app/src/main/res/xml/shortcuts.xml` declaring a
  `<capability>` per built-in intent (e.g. `actions.intent.ADD_ITEM`) or a custom
  capability, each `<intent>` targeting the deep links above with a `<url-template>`
  and `<parameter>` binding for `name`. Generated via an Expo **config plugin** that
  writes `shortcuts.xml` and the `<meta-data android:name="android.app.shortcuts">`
  during prebuild.
- **iOS** — `AppIntents` structs (or an Intents extension) exposing "Add to
  Simmerplan shopping list" as a Siri Shortcut / App Shortcut that opens the same URL.

## Follow-up checklist

- [ ] SIM-39 produces the native projects (prebuild).
- [ ] Add the Expo config plugin that emits `shortcuts.xml` + the App Actions
      `<meta-data>`; map the capability parameters to the `name` query param.
- [ ] Add the iOS App Intents target mirroring the same deep links.
- [ ] Optionally add a "what can I make tonight" capability → `simmerplan://meal-plan`
      that triggers `mealplan.suggest`.
- [ ] Re-verify built-in intent IDs and the App Actions test tool against current
      Google docs before wiring (the surface changes often — see SIM-7).
