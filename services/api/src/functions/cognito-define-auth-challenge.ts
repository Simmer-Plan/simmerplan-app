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

// Cognito DefineAuthChallenge trigger for the CUSTOM_AUTH Google sign-in flow
// (SIM-29). One custom challenge: present a valid Google idToken.

import type { DefineAuthChallengeTriggerEvent } from 'aws-lambda';

export const handler = async (
  event: DefineAuthChallengeTriggerEvent,
): Promise<DefineAuthChallengeTriggerEvent> => {
  const lastChallenge = event.request.session.at(-1);

  if (lastChallenge?.challengeName === 'CUSTOM_CHALLENGE' && lastChallenge.challengeResult) {
    event.response.issueTokens = true;
    event.response.failAuthentication = false;
  } else if (event.request.session.length >= 2) {
    // One retry at most — a bad Google token is not going to improve.
    event.response.issueTokens = false;
    event.response.failAuthentication = true;
  } else {
    event.response.issueTokens = false;
    event.response.failAuthentication = false;
    event.response.challengeName = 'CUSTOM_CHALLENGE';
  }
  return event;
};
