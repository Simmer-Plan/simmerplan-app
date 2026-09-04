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

import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DEFAULT_DIETARY_PREFERENCES } from '@simmerplan/types';
import { buildSuggestionPrompt, generateMealSuggestions, parseSuggestions } from '../src/lib/bedrock';

const bedrock = mockClient(BedrockRuntimeClient);

const CTX = {
  pantryItemNames: ['Rice', 'Beans'],
  recipes: [{ recipeId: 'r1', name: 'Chili', ingredients: ['beans', 'onion'] }],
  dietary: { ...DEFAULT_DIETARY_PREFERENCES, dietType: 'vegetarian' },
  count: 2,
};

describe('buildSuggestionPrompt', () => {
  it('includes pantry, recipes, and dietary in the prompt', () => {
    const { system, user } = buildSuggestionPrompt(CTX);
    expect(system).toMatch(/meal-planning assistant/i);
    expect(user).toContain('Rice');
    expect(user).toContain('Chili');
    expect(user).toContain('vegetarian');
    expect(user).toContain('Suggest 2 meal ideas');
  });
});

describe('parseSuggestions', () => {
  it('parses a plain JSON array', () => {
    const out = parseSuggestions('[{"title":"Rice Bowl","description":"Quick","recipeId":"r1","usesPantryItems":["Rice"]}]');
    expect(out).toEqual([
      { title: 'Rice Bowl', description: 'Quick', recipeId: 'r1', usesPantryItems: ['Rice'] },
    ]);
  });
  it('tolerates surrounding prose / code fences', () => {
    const out = parseSuggestions('Here you go:\n```json\n[{"title":"Beans"}]\n```\nEnjoy!');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: 'Beans', recipeId: null, usesPantryItems: [] });
  });
  it('returns [] on junk', () => {
    expect(parseSuggestions('no json here')).toEqual([]);
    expect(parseSuggestions('[not json]')).toEqual([]);
  });
  it('drops entries without a title', () => {
    expect(parseSuggestions('[{"description":"x"},{"title":"Keep"}]')).toEqual([
      { title: 'Keep', description: '', recipeId: null, usesPantryItems: [] },
    ]);
  });
});

describe('generateMealSuggestions', () => {
  beforeEach(() => {
    bedrock.reset();
  });

  it('invokes Bedrock and parses the model output', async () => {
    bedrock.on(InvokeModelCommand).resolves({
      body: new TextEncoder().encode(
        JSON.stringify({ content: [{ type: 'text', text: '[{"title":"Bean Bowl","description":"Tasty","recipeId":"r1","usesPantryItems":["Beans"]}]' }] }),
      ),
    } as never);

    const out = await generateMealSuggestions(CTX);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: 'Bean Bowl', recipeId: 'r1' });
    expect(bedrock.commandCalls(InvokeModelCommand)).toHaveLength(1);
  });
});
