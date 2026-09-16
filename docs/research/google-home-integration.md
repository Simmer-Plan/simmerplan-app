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

# Research — Google Home / Assistant integration (SIM-7)

**Status:** research complete; recommendation below. No product code in this PR — it
scopes SIM-19 (Calendar) and SIM-20 (voice) and records the decisions those tickets
depend on.

## Goal

Let Simmerplan users interact by voice / ambient surfaces: add pantry or shopping-list
items hands-free ("add milk to the shopping list"), hear "what can I make tonight",
and surface the weekly plan — without building a voice app on a deprecated platform.

## Landscape (as of 2026)

The third-party voice surface has shifted significantly. The options, and their fit:

| Option | What it is | Fit for Simmerplan | Verdict |
|---|---|---|---|
| **Conversational Actions** (Dialogflow / Actions SDK) | The old "build an Assistant app" path | Deprecated (shut down June 2023) — do not build here | ❌ Dead end |
| **App Actions** (Android shortcuts + `shortcuts.xml`, `Capability`/BII) | Voice/Assistant triggers that deep-link into the installed Android app | Strong: "Hey Google, add milk on Simmerplan" opens/executes in-app | ✅ Primary voice path (Android) |
| **Smart Home Actions** | Cloud fulfillment for controlling *devices* (lights, plugs) | Simmerplan controls no devices | ❌ Wrong tool |
| **Google Home APIs / Home runtime** (2024+) | Device + automation control for the Home app | Not a meal-planning surface | ❌ Not applicable |
| **Structured data (schema.org/Recipe)** | Recipe markup Google Search/Assistant can read | We already emit/consume `Recipe` JSON-LD (SIM-12); mainly relevant if a public web surface exists | ◑ Opportunistic, web-only |
| **Google Keep / Tasks shopping list** | Assistant's built-in "add to my shopping list" writes to Keep/Tasks | One-way export target, not a Simmerplan integration | ◑ Export only (see SIM-17) |
| **Gemini / Assistant extensions** | Newer assistant surface | APIs still consolidating; no stable third-party CRUD contract to build against yet | ⏳ Watch, don't commit |

## Recommendation

1. **Voice-in (Android): App Actions.** Ship built-in intents / custom `Capability`
   entries backed by `shortcuts.xml` so Assistant can deep-link into the app for a
   small, high-value set of actions:
   - `GET_THING` / custom "what can I make tonight" → open the meal-plan suggestions.
   - Custom "add `<item>` to shopping list" → deep-link `simmerplan://grocery/add?name=<item>`
     that calls `grocery.addItem` (SIM-17 backend already exists).
   - "Add `<item>` to pantry" → `simmerplan://pantry/add?name=<item>`.
   These require **only** an Android **dev/production build** (App Actions do not run in
   Expo Go) and an `android/app/src/main/res/xml/shortcuts.xml` produced by the Expo
   prebuild — i.e. gated on the EAS work in **SIM-39**.
2. **Shopping-list export.** Keep the plain-text share (SIM-17) as the universal path;
   a Keep/Tasks "add to shopping list" hand-off is a nice-to-have, not a dependency.
3. **iOS parity: App Intents / Siri Shortcuts.** The App Actions equivalent on iOS is
   App Intents (Siri Shortcuts). Same deep-link handlers, different manifest. Treat as a
   sibling of the Android work, not a Google dependency.
4. **Do not** build Conversational/Smart Home Actions or a cloud voice-fulfillment
   webhook. `webhook-handler.ts` should stay reserved for a **narrow** deep-link/App
   Actions inventory-availability callback if one is ever needed, not a full voice agent.

## Impact on other tickets

- **SIM-20 (voice command integration):** re-scope to **App Actions (Android) + App
  Intents (iOS)** deep-linking into existing tRPC endpoints (`grocery.addItem`,
  `pantry.createItem`, `mealplan.suggest`). Hard-blocked on **SIM-39** (native dev
  build; not possible in Expo Go). No new backend beyond the deep-link routes.
- **SIM-19 (Google Calendar):** independent of Home — it's the Calendar REST API +
  an OAuth **calendar.readonly** scope to detect busy evenings and feed SIM-18. Blocked
  on adding the calendar scope to the Google OAuth consent screen + a token-exchange
  flow (the app currently requests only `openid/email/profile`). Track the added scope
  and a `calendar` service/router separately.

## Concrete follow-ups to file

- [ ] SIM-20: define the App Actions `shortcuts.xml` capability list + deep-link routes
      (`grocery/add`, `pantry/add`, `meal-plan/suggest`); iOS App Intents mirror. Depends on SIM-39.
- [ ] SIM-19: request `https://www.googleapis.com/auth/calendar.readonly`; add a calendar
      router that lists the next 7 days' evening events and maps them to busy nights (SIM-18).
- [ ] Confirm the custom scheme `simmerplan://` (already set in `app.json`) covers the
      deep-link targets; add the `/grocery` and `/pantry` intent filters when SIM-20 lands.

## Sources to re-verify at implementation time

Google deprecates/rebrands these surfaces often — re-check the official docs when SIM-19/20
start: App Actions (built-in intents & custom capabilities), Android shortcuts, iOS App
Intents, and the current Google Calendar API scopes. Do not rely on this document's specifics
without re-confirming they are still current.
