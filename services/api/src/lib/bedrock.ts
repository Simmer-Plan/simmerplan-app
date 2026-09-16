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

// AI meal suggestions via Amazon Bedrock (SIM-14). Uses the AWS Bedrock Runtime
// InvokeModel path with the Anthropic Messages API body — @aws-sdk/* is already
// a dependency and is provided by the Lambda runtime (externalised by esbuild),
// so nothing extra is bundled. Prompt building and response parsing are pure
// functions so they can be unit tested without calling Bedrock.
//
// CLAUDE.md pins Sonnet for meal planning; the exact Bedrock model/inference-
// profile id is environment-specific, so it is read from BEDROCK_MODEL_ID.

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type { DietaryPreferences, MealSuggestion } from '@simmerplan/types';

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'anthropic.claude-sonnet-5';
const ANTHROPIC_VERSION = 'bedrock-2023-05-31';

const bedrock = new BedrockRuntimeClient({});

export interface SuggestionContext {
  pantryItemNames: string[];
  recipes: { recipeId: string; name: string; ingredients: string[] }[];
  dietary: DietaryPreferences;
  count: number;
  mealType?: string;
}

const SYSTEM_PROMPT =
  'You are a household meal-planning assistant. Suggest meals that use what the ' +
  'household already has in the pantry, respect their dietary restrictions, and ' +
  'prefer their saved recipes when a good match exists. Reply with ONLY a JSON ' +
  'array — no prose, no code fences.';

/** Build the (system, user) prompt for a suggestion request. Pure. */
export function buildSuggestionPrompt(ctx: SuggestionContext): { system: string; user: string } {
  const payload = {
    request: {
      count: ctx.count,
      mealType: ctx.mealType ?? 'any',
    },
    dietary: ctx.dietary,
    pantry: ctx.pantryItemNames,
    savedRecipes: ctx.recipes.map((r) => ({ recipeId: r.recipeId, name: r.name, ingredients: r.ingredients })),
    responseSchema: {
      type: 'array',
      items: {
        title: 'string',
        description: 'string — one or two sentences',
        recipeId: 'string id from savedRecipes, or null if this is a new idea',
        usesPantryItems: 'array of pantry item names this meal uses',
      },
    },
  };
  return {
    system: SYSTEM_PROMPT,
    user: `Suggest ${ctx.count} meal ideas. Context:\n${JSON.stringify(payload, null, 2)}`,
  };
}

/** Extract the JSON suggestion array from a model text response. Pure. */
export function parseSuggestions(text: string): MealSuggestion[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({
      title: String(s.title ?? '').trim(),
      description: String(s.description ?? '').trim(),
      recipeId: typeof s.recipeId === 'string' && s.recipeId ? s.recipeId : null,
      usesPantryItems: Array.isArray(s.usesPantryItems)
        ? s.usesPantryItems.map((n) => String(n)).filter(Boolean)
        : [],
    }))
    .filter((s) => s.title.length > 0);
}

/** Call Bedrock and return parsed meal suggestions. */
export async function generateMealSuggestions(ctx: SuggestionContext): Promise<MealSuggestion[]> {
  const { system, user } = buildSuggestionPrompt(ctx);
  const body = {
    anthropic_version: ANTHROPIC_VERSION,
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
  };

  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body),
    }),
  );

  const decoded = JSON.parse(new TextDecoder().decode(response.body)) as {
    content?: { type?: string; text?: string }[];
  };
  const text = (decoded.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
  return parseSuggestions(text);
}
