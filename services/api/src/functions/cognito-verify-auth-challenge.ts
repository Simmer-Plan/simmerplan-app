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

// Cognito VerifyAuthChallengeResponse trigger (SIM-29). Validates the Google
// idToken against Google's JWKS and requires its sub to match the Cognito
// username (users are keyed by Google sub).

import type { VerifyAuthChallengeResponseTriggerEvent } from 'aws-lambda';
import { verifyGoogleIdToken } from '../lib/google';
import { getSecret } from '../lib/secrets';

export const handler = async (
  event: VerifyAuthChallengeResponseTriggerEvent,
): Promise<VerifyAuthChallengeResponseTriggerEvent> => {
  try {
    const googleClientId = await getSecret('google-oauth-client-id');
    const identity = await verifyGoogleIdToken(event.request.challengeAnswer, googleClientId);
    event.response.answerCorrect = identity.googleId === event.userName;
  } catch {
    event.response.answerCorrect = false;
  }
  return event;
};
