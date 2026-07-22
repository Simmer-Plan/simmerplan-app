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

export type Role = 'owner' | 'member';

export interface UserRecord {
  userId: string;
  householdId: string | null;
  role: Role | null;
  googleId: string;
  email: string;
  name: string;
  photoUrl: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface HouseholdRecord {
  householdId: string;
  name: string;
  createdBy: string;
  /** Maintained on create/join so GET /household can list members without a GSI. */
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface InviteRecord {
  tokenId: string;
  householdId: string;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
  /** Unix seconds — DynamoDB TTL, expiry + 7 days. */
  TTL: number;
}
