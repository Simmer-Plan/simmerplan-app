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
import { computeShoppingList, sectionFor } from '../src/lib/shopping';

describe('sectionFor', () => {
  it('classifies common items', () => {
    expect(sectionFor('Roma Tomatoes')).toBe('produce');
    expect(sectionFor('Cheddar cheese')).toBe('dairy');
    expect(sectionFor('Chicken breast')).toBe('meat');
    expect(sectionFor('Sourdough bread')).toBe('bakery');
    expect(sectionFor('Frozen peas')).toBe('frozen');
    expect(sectionFor('Basmati rice')).toBe('pantry');
    expect(sectionFor('Widget')).toBe('other');
  });
});

describe('computeShoppingList', () => {
  it('returns ingredients not covered by pantry, de-duplicated', () => {
    const recipes = [
      { ingredients: ['2 cups flour', 'Eggs', 'Milk'] },
      { ingredients: ['Milk', 'Sugar'] },
    ];
    const gaps = computeShoppingList(recipes, ['eggs', 'milk']);
    // flour + sugar are gaps; eggs/milk covered; milk not duplicated.
    expect(gaps).toEqual(['2 cups flour', 'Sugar']);
  });

  it('covers an ingredient when a pantry name is contained in it', () => {
    const gaps = computeShoppingList([{ ingredients: ['1 lb ground beef'] }], ['beef']);
    expect(gaps).toEqual([]);
  });

  it('returns everything when the pantry is empty', () => {
    const gaps = computeShoppingList([{ ingredients: ['Salt', 'Pepper'] }], []);
    expect(gaps).toEqual(['Salt', 'Pepper']);
  });
});
