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

// Recipe import from a URL (SIM-12): parse schema.org/Recipe JSON-LD embedded
// in a page into a draft. Pure functions — no network — so they are unit
// testable; the router does the fetch and the pantry mapping.

import type { RecipeDraft } from '@simmerplan/types';

/** Convert an ISO-8601 duration (e.g. PT1H30M) to whole minutes, or null. */
export function isoDurationToMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?)?$/.exec(value.trim());
  if (!match) return null;
  const [, d, h, m] = match;
  const minutes = (Number(d ?? 0) * 24 + Number(h ?? 0)) * 60 + Number(m ?? 0);
  return minutes > 0 ? minutes : null;
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const v of value) {
      const s = firstString(v);
      if (s) return s;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const url = (value as { url?: unknown }).url;
    if (typeof url === 'string') return url;
  }
  return null;
}

function toStringArray(value: unknown): string[] {
  if (value == null) return [];
  const out: string[] = [];
  const visit = (v: unknown): void => {
    if (typeof v === 'string') {
      const t = v.trim();
      if (t) out.push(t);
    } else if (Array.isArray(v)) {
      v.forEach(visit);
    } else if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      // HowToSection wraps steps under itemListElement; HowToStep uses text/name.
      if (obj.itemListElement) visit(obj.itemListElement);
      else if (typeof obj.text === 'string') visit(obj.text);
      else if (typeof obj.name === 'string') visit(obj.name);
    }
  };
  visit(value);
  return out;
}

function hasType(node: Record<string, unknown>, type: string): boolean {
  const t = node['@type'];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

/** Extract every application/ld+json block's parsed JSON from an HTML string. */
export function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(match[1].trim()));
    } catch {
      // Ignore malformed blocks.
    }
  }
  return blocks;
}

/** Find the first schema.org Recipe node across blocks, arrays and @graph. */
export function findRecipeNode(blocks: unknown[]): Record<string, unknown> | null {
  const queue = [...blocks];
  while (queue.length) {
    const node = queue.shift();
    if (Array.isArray(node)) {
      queue.push(...node);
    } else if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      if (hasType(obj, 'Recipe')) return obj;
      if (Array.isArray(obj['@graph'])) queue.push(...(obj['@graph'] as unknown[]));
    }
  }
  return null;
}

/** Parse a schema.org/Recipe from page HTML into an editable draft, or null. */
export function parseRecipeJsonLd(html: string): RecipeDraft | null {
  const node = findRecipeNode(extractJsonLdBlocks(html));
  if (!node) return null;

  const name = firstString(node.name);
  if (!name) return null;

  const keywords = node.keywords;
  const tags = Array.isArray(keywords)
    ? toStringArray(keywords)
    : typeof keywords === 'string'
      ? keywords.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

  return {
    name,
    description: firstString(node.description) ?? '',
    photoUrl: firstString(node.image),
    ingredients: toStringArray(node.recipeIngredient).map((ingredientName) => ({
      name: ingredientName,
      quantity: null,
      unit: null,
      pantryItemId: null,
    })),
    instructions: toStringArray(node.recipeInstructions),
    prepTimeMinutes: isoDurationToMinutes(node.prepTime),
    cookTimeMinutes: isoDurationToMinutes(node.cookTime),
    complexity: 'simple',
    tags,
  };
}
