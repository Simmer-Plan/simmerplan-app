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

import { describe, expect, it } from 'vitest';
import { isoDurationToMinutes, parseRecipeJsonLd } from '../src/lib/recipe-import';

describe('isoDurationToMinutes', () => {
  it('parses hours and minutes', () => {
    expect(isoDurationToMinutes('PT1H30M')).toBe(90);
    expect(isoDurationToMinutes('PT20M')).toBe(20);
    expect(isoDurationToMinutes('PT2H')).toBe(120);
    expect(isoDurationToMinutes('P1DT1H')).toBe(25 * 60);
  });
  it('returns null for junk', () => {
    expect(isoDurationToMinutes('30 minutes')).toBeNull();
    expect(isoDurationToMinutes(undefined)).toBeNull();
    expect(isoDurationToMinutes('PT0M')).toBeNull();
  });
});

function page(jsonLd: unknown): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head><body></body></html>`;
}

describe('parseRecipeJsonLd', () => {
  it('parses a flat Recipe node', () => {
    const draft = parseRecipeJsonLd(
      page({
        '@context': 'https://schema.org',
        '@type': 'Recipe',
        name: 'Test Chili',
        description: 'Spicy',
        image: 'https://example.com/chili.jpg',
        recipeIngredient: ['2 cups beans', '1 onion'],
        recipeInstructions: [
          { '@type': 'HowToStep', text: 'Chop onion' },
          { '@type': 'HowToStep', text: 'Simmer' },
        ],
        prepTime: 'PT10M',
        cookTime: 'PT40M',
        keywords: 'vegetarian, spicy',
      }),
    );
    expect(draft).not.toBeNull();
    expect(draft?.name).toBe('Test Chili');
    expect(draft?.photoUrl).toBe('https://example.com/chili.jpg');
    expect(draft?.ingredients.map((i) => i.name)).toEqual(['2 cups beans', '1 onion']);
    expect(draft?.instructions).toEqual(['Chop onion', 'Simmer']);
    expect(draft?.prepTimeMinutes).toBe(10);
    expect(draft?.cookTimeMinutes).toBe(40);
    expect(draft?.tags).toEqual(['vegetarian', 'spicy']);
  });

  it('finds a Recipe inside an @graph', () => {
    const draft = parseRecipeJsonLd(
      page({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebSite', name: 'Site' },
          { '@type': ['Recipe'], name: 'Graph Cake', recipeIngredient: ['flour'], recipeInstructions: 'Bake it' },
        ],
      }),
    );
    expect(draft?.name).toBe('Graph Cake');
    expect(draft?.instructions).toEqual(['Bake it']);
    expect(draft?.ingredients).toHaveLength(1);
  });

  it('flattens HowToSection instructions', () => {
    const draft = parseRecipeJsonLd(
      page({
        '@type': 'Recipe',
        name: 'Sectioned',
        recipeInstructions: [
          { '@type': 'HowToSection', itemListElement: [{ '@type': 'HowToStep', text: 'Prep' }, { '@type': 'HowToStep', text: 'Cook' }] },
        ],
      }),
    );
    expect(draft?.instructions).toEqual(['Prep', 'Cook']);
  });

  it('returns null when there is no Recipe', () => {
    expect(parseRecipeJsonLd(page({ '@type': 'Article', name: 'Not a recipe' }))).toBeNull();
    expect(parseRecipeJsonLd('<html><body>nothing</body></html>')).toBeNull();
  });
});
