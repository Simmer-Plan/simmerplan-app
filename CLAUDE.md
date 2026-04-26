# Simmerplan — CLAUDE.md

Simmerplan is a household meal planning app. Users manage a shared pantry, save recipes, generate weekly meal plans (AI-assisted via Amazon Bedrock), and sync across devices in real time using a delta-diff architecture.

**Owner:** Dave LeBlanc | **License:** Apache 2.0 | **Domain:** simmerplan.com | **Region:** ca-central-1

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React Native + Expo 52 (iOS, Android, Web) |
| Backend | Node.js 22 + TypeScript — AWS Lambda (arm64) |
| API | tRPC (internal app ↔ Lambda) + REST (Google Home webhooks) |
| Database | AWS DynamoDB — single-table design |
| Auth | AWS Cognito — Google OAuth; `householdId` as custom JWT claim |
| AI | Amazon Bedrock — Claude (`haiku` for cost, `sonnet` for meal planning) |
| Hosting | Lambda + API Gateway (API), CloudFront + S3 (web) |
| IaC | Terraform (AWS provider) |
| CaC | Ansible |
| CI/CD | GitHub Actions + OIDC |
| Push Notifications | Firebase Cloud Messaging (FCM) |

---

## Monorepo Structure

```
simmerplan-app/
├── apps/mobile/          # React Native + Expo — @simmerplan/mobile
├── packages/types/       # Shared TypeScript types — @simmerplan/types
├── services/api/         # Lambda functions — @simmerplan/api
│   ├── src/functions/    # One file per Lambda handler
│   ├── src/lib/          # dynamo.ts, cognito.ts, secrets.ts, diff.ts
│   └── esbuild.config.ts # Bundles each function to dist/ for deployment
└── scripts/              # DynamoDB scaffold + seeding scripts
```

Package manager: **pnpm 9+** | Node.js: **22+**

---

## Prerequisites & First-Time Setup

```bash
pnpm install

# Build shared types first — mobile and api depend on them
pnpm --filter @simmerplan/types build
```

AWS CLI must be configured with named profiles:
- `simmerplan-sandbox` → sandbox account
- `simmerplan-prod` → prod account

---

## Common Commands

```bash
# Mobile
pnpm --filter @simmerplan/mobile start          # Expo dev server

# API / Lambda
pnpm --filter @simmerplan/api build             # esbuild → dist/
pnpm --filter @simmerplan/api build:watch       # Watch mode

# Types
pnpm --filter @simmerplan/types build           # tsc → compile shared types

# Workspace-wide
pnpm build                                      # Build all packages
pnpm lint                                       # ESLint all
pnpm format                                     # Prettier all
```

---

## Lambda Function Development

### Handlers (services/api/src/functions/)

| Handler | API Gateway Route | Notes |
|---|---|---|
| `auth-authorizer.ts` | (authorizer) | Verifies JWT; extracts `householdId` |
| `auth-handler.ts` | `/auth/{proxy+}` | Cognito-backed auth endpoints |
| `household-handler.ts` | `/household/{proxy+}` | Household management + invites |
| `sync-handler.ts` | `/sync/{proxy+}` | Delta sync: `/diffs`, `/hash`, `/full` |
| `pantry-handler.ts` | `/pantry/{proxy+}` | Pantry CRUD |
| `recipe-handler.ts` | `/recipes/{proxy+}` | Recipe CRUD |
| `mealplan-handler.ts` | `/mealplans/{proxy+}` | Meal plan + Bedrock suggestions |
| `grocery-handler.ts` | `/grocery/{proxy+}` | Grocery list |
| `schedule-handler.ts` | `/schedule/{proxy+}` | Per-user weekly schedule |
| `webhook-handler.ts` | `/webhooks/{proxy+}` | Google Home — no JWT auth |
| `hash-recompute-job.ts` | (EventBridge) | Nightly cron at 02:00 UTC |

Lambda config: `nodejs22.x`, `arm64`, 256 MB, 30s timeout, 5 concurrent (sandbox) / 10 (prod).

### Building

esbuild bundles each `.ts` file in `src/functions/` to a separate file in `dist/`. `@aws-sdk/*` is excluded (pre-installed in the Node 22 Lambda runtime).

```bash
pnpm --filter @simmerplan/api build
```

### Local Testing with tsx

Run a handler file directly against sandbox DynamoDB:

```bash
AWS_REGION=ca-central-1 \
DYNAMODB_TABLE=simmerplan-sandbox \
ENVIRONMENT=sandbox \
AWS_PROFILE=simmerplan-sandbox \
npx tsx services/api/src/functions/<handler>.ts
```

**SST** is the preferred full local Lambda dev experience (live reload, local invoke, real API Gateway emulation) — referenced in the architecture docs as the gold-standard TypeScript + Lambda local dev toolchain. SST is not yet wired up in this repo; when added, the `sst.config.ts` goes at the monorepo root.

### Required Environment Variables

| Variable | Description |
|---|---|
| `DYNAMODB_TABLE` | `simmerplan-sandbox` or `simmerplan-prod` |
| `AWS_REGION` | `ca-central-1` |
| `ENVIRONMENT` | `sandbox` \| `prod` |
| `AWS_PROFILE` | Optional — for local runs only |

Additional secrets are read at runtime from AWS Secrets Manager at `simmerplan/<env>/<secret>`:
- `invite-signing-key`
- `google-oauth-client-id` / `google-oauth-client-secret`
- `fcm-server-key`

---

## Database — DynamoDB

### Table

Name driven by `DYNAMODB_TABLE` env var: `simmerplan-sandbox` / `simmerplan-prod`.

```
PK  (String) — partition key
SK  (String) — sort key
GSI1: GSI1PK / GSI1SK — diff log queries, household-scoped across all entity types
GSI2: GSI2PK / GSI2SK — recipe ingredient lookups (which recipes use a pantry item)
```

Billing: `PAY_PER_REQUEST`. Deletion protection + PITR enabled in prod only.

### Single-Table Key Patterns

```
HOUSEHOLD#<householdId>          METADATA              → HOUSEHOLD
INVITE#<tokenId>                 METADATA              → HOUSEHOLD_INVITE
USER#<userId>                    METADATA              → USER
USER#<userId>                    SCHEDULE#WEEKLY       → SCHEDULE
HOUSEHOLD#<id>#STORAGE_LOCATIONS LOCATION#<locationId> → STORAGE_LOCATION
HOUSEHOLD#<id>#PANTRY            ITEM#<itemId>          → PANTRY_ITEM
HOUSEHOLD#<id>#RECIPES           RECIPE#<recipeId>      → RECIPE
RECIPE#<recipeId>                INGREDIENT#<id>        → RECIPE_INGREDIENT
HOUSEHOLD#<id>#GROCERY           ITEM#<groceryItemId>   → GROCERY_LIST
HOUSEHOLD#<id>#MEAL_PLANS        PLAN#<planId>          → MEAL_PLAN
PLAN#<planId>                    SLOT#<day>#<mealType>  → MEAL_PLAN_SLOT
HOUSEHOLD#<id>#DIFF#<entityType> SEQ#<000000000001>#<itemId> → DIFF_LOG
HOUSEHOLD#<id>#META#<entityType> CURRENT               → DATASET_META
```

All shared entity partitions use `HOUSEHOLD#<householdId>` — never a generic `SHARED#` prefix.
`householdId` is extracted from the verified Cognito JWT claim (`custom:householdId`) — never trusted from the request body.

### Delta Sync

Every write: `TransactWrite` (entity + sequence increment + DIFF_LOG entry) → return response → background hash recompute.

Client sync flow on app launch:
1. Load local cache from AsyncStorage
2. `GET /sync/diffs?since=<lastSeq>&entityTypes=all` — apply diffs
3. `GET /sync/hash?entityTypes=all` — compare SHA-256 hashes
4. Hash mismatch → `GET /sync/full?entityTypes=<type>` (full refresh for that type)

Sequence numbers are zero-padded to 12 digits for correct lexicographic sort in DynamoDB.

### Scaffold Script

Creates the table and GSIs idempotently. Safe to re-run.

```bash
DYNAMODB_TABLE=simmerplan-sandbox \
AWS_REGION=ca-central-1 \
ENVIRONMENT=sandbox \
AWS_PROFILE=simmerplan-sandbox \
npx tsx scripts/scaffold-db.ts

# Or via package.json script:
pnpm scaffold:db
```

---

## Infrastructure (simmerplan-infra repo)

### AWS Accounts

```
Management account (existing personal account)
└── OU: simmerplan
    ├── simmerplan-sandbox   → dev/testing, freely destroyable
    └── simmerplan-prod      → live app, never destroyed
                               domain: simmerplan.com registered here
```

Terraform state: S3 + DynamoDB lock table per sub-account. Management uses local state only.

### Naming Conventions

| Resource | Pattern | Example |
|---|---|---|
| DynamoDB | `simmerplan-<env>` | `simmerplan-sandbox` |
| Lambda | `simmerplan-<handler>-<env>` | `simmerplan-pantry-handler-sandbox` |
| S3 (web) | `simmerplan-web-<env>` | `simmerplan-web-prod` |
| S3 (artifacts) | `simmerplan-lambda-artifacts-<env>` | |
| S3 (tf state) | `simmerplan-terraform-state-<account-id>` | |
| Cognito | `simmerplan-<env>` | `simmerplan-prod` |
| Cognito client | `simmerplan-mobile-<env>` | |
| API Gateway | `simmerplan-<env>` | |
| CloudWatch log | `/aws/lambda/simmerplan-<handler>-<env>` | |
| Secrets | `simmerplan/<env>/<secret>` | `simmerplan/prod/invite-signing-key` |
| EventBridge | `simmerplan-<job>-<env>` | `simmerplan-nightly-hash-recompute-prod` |

Standard tags on all resources: `Project=simmerplan`, `Environment=<env>`, `ManagedBy=terraform`, `Owner=dave-leblanc`.

### Regions

Primary: `ca-central-1`. ACM (for CloudFront) must be provisioned in `us-east-1` via a provider alias.

### Key URLs

| Purpose | URL |
|---|---|
| Web app | `simmerplan.com` / `www.simmerplan.com` |
| API | `api.simmerplan.com` |
| Household invite | `simmerplan.com/join` |
| Cognito callback (prod) | `https://simmerplan.com/auth` |
| Cognito callback (sandbox) | `exp://localhost:19000/--/auth` |

---

## Branch Strategy & CI/CD

```
main       → prod deploys (manual approval gate in GitHub Actions)
develop    → sandbox deploys (auto-apply on merge)
feature/*  → PRs into develop
```

CI pipeline (GitHub Actions + OIDC — no long-lived AWS keys):
- `terraform_plan.yml` — on PR: plan + tfsec diff posted to PR
- `terraform_apply.yml` — on merge: sandbox auto-apply; prod requires manual approval
- `ansible_deploy.yml` — post apply: `deploy_lambda` → `deploy_static` → `health_check`

---

## Mobile App

- File-based routing via **Expo Router 4**
- `(auth)/sign-in.tsx` — unauthenticated flow
- `(app)/` — authenticated tab layout: recipes, meal-plan, pantry, settings
- `lib/api.ts` — tRPC client
- `lib/auth.ts` — Cognito auth helpers
- `lib/sync.ts` — delta sync logic + AsyncStorage cache

Universal Links (prod): `https://simmerplan.com/join`
Custom scheme (Expo Go dev only): `simmerplan://join`

EAS build profiles: `development` (internal + dev client), `preview` (internal), `production` (stores).

---

## Code Conventions

### License Headers

Add to the top of all non-trivial source files (`*.ts`, `*.tsx`). Omit from JSON, generated files, and config files.

```typescript
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
```

### TypeScript

- Strict mode enabled (`tsconfig.base.json`)
- Target: ES2022, `moduleResolution: "bundler"`
- Shared types live in `packages/types/` — import as `@simmerplan/types`
- Lambda functions use `esbuild` with `external: ['@aws-sdk/*']`

### Formatting

- ESLint + Prettier enforced; run `pnpm lint` and `pnpm format`
- Prettier: semi-colons on, single quotes, trailing commas, 100-char width, 2-space indent

---

## Linear Issue Tracking

Project tracked in Linear under team **Simmer-Plan**.

Key completed decisions:
- **SIM-23** (Done) — Architecture decision matrix; full stack choices documented
- **SIM-6** (Done) — DynamoDB schema design; single-table patterns, delta sync, hash strategy

Active work:
- **SIM-5** (In Progress) — Overall system architecture definition
- **SIM-24** (In Review) — IaC planning; full Terraform resource inventory in the linked doc
- **SIM-28** (In Review) — Repo and project structure setup

Upcoming:
- **SIM-30** (Todo) — DynamoDB scaffold script (`scripts/scaffold-db.ts`)
