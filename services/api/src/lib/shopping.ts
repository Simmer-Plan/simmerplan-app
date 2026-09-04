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

// Shopping-list helpers (SIM-17). Pure functions: compute the pantry-gap
// ingredient list for a set of planned recipes, and classify an item into a
// store section.

import type { StoreSection } from '@simmerplan/types';

/** Classify an item name into a store section by keyword. */
export function sectionFor(name: string): StoreSection {
  const n = name.toLowerCase();
  if (/lettuce|tomato|onion|pepper|carrot|potato|garlic|apple|banana|spinach|broccoli|cucumber|celery|herb|cilantro|parsley|lemon|lime|avocado|mushroom|fruit|vegetable/.test(n)) {
    return 'produce';
  }
  if (/milk|cheese|yogurt|yoghurt|butter|cream|egg/.test(n)) return 'dairy';
  if (/chicken|beef|pork|turkey|lamb|fish|salmon|shrimp|bacon|sausage|meat/.test(n)) return 'meat';
  if (/bread|bagel|bun|tortilla|roll|baguette|pastry/.test(n)) return 'bakery';
  if (/frozen|ice cream/.test(n)) return 'frozen';
  if (/rice|pasta|flour|sugar|bean|lentil|oil|vinegar|sauce|spice|salt|pepper|can|cereal|stock|broth/.test(n)) {
    return 'pantry';
  }
  return 'other';
}

/**
 * Ingredient names required by the planned recipes that are not already covered
 * by pantry stock. De-duplicated (case-insensitive); a pantry item covers an
 * ingredient when either name contains the other (e.g. "Flour" covers
 * "2 cups flour").
 */
export function computeShoppingList(
  recipes: { ingredients: string[] }[],
  pantryNames: string[],
): string[] {
  const have = pantryNames.map((n) => n.trim().toLowerCase()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients) {
      const key = ingredient.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const covered = have.some((h) => key.includes(h) || h.includes(key));
      if (!covered) out.push(ingredient.trim());
    }
  }
  return out;
}
