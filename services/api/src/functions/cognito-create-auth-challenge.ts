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

// Cognito CreateAuthChallenge trigger (SIM-29). The challenge carries no
// server-generated material — the answer is the client's Google idToken,
// verified by the VerifyAuthChallengeResponse trigger.

import type { CreateAuthChallengeTriggerEvent } from 'aws-lambda';

export const handler = async (
  event: CreateAuthChallengeTriggerEvent,
): Promise<CreateAuthChallengeTriggerEvent> => {
  if (event.request.challengeName === 'CUSTOM_CHALLENGE') {
    event.response.publicChallengeParameters = { challenge: 'GOOGLE_ID_TOKEN' };
    event.response.privateChallengeParameters = {};
    event.response.challengeMetadata = 'GOOGLE_ID_TOKEN';
  }
  return event;
};
