# simmerplan-app

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Application monorepo for Simmerplan — React Native + Expo frontend and Node.js/TypeScript Lambda backend.

## Structure

```
apps/mobile        React Native + Expo (Expo Router)
packages/types     Shared TypeScript types
services/api       AWS Lambda functions (Node.js 22, TypeScript)
scripts/           Utility scripts (DB scaffolding, seeding)
```

## Prerequisites

- Node.js 22+
- pnpm 9+
- AWS CLI configured
- Expo CLI (`pnpm add -g expo-cli`)

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Configure infrastructure — see the IaC runbook in [SIM-24](https://linear.app/simmer-plan/issue/SIM-24).

3. Start the mobile app:
   ```bash
   pnpm --filter @simmerplan/mobile start
   ```

4. Build Lambda functions:
   ```bash
   pnpm --filter @simmerplan/api build
   ```

## Next steps:

  1. Configure AWS CLI profiles:
       aws configure --profile simmerplan-sandbox
       aws configure --profile simmerplan-prod

  2. Scaffold the DynamoDB table (sandbox):
       pnpm scaffold:db

  3. Start the mobile app:
       pnpm --filter @simmerplan/mobile start

  4. Build Lambda functions:
       pnpm --filter @simmerplan/api build

## Branch Strategy

| Branch | Deploys to |
|--------|-----------|
| `main` | prod (manual approval gate) |
| `develop` | sandbox (auto-apply on merge) |
| `feature/*` | PRs into `develop` |
