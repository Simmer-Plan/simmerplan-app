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
import { mapCategoryToLocationKind, parseOpenFoodFactsProduct } from '../src/lib/barcode';

describe('mapCategoryToLocationKind', () => {
  it('routes frozen to the freezer', () => {
    expect(mapCategoryToLocationKind('Frozen foods, Frozen pizzas')).toBe('freezer');
  });
  it('routes fresh/dairy to the fridge', () => {
    expect(mapCategoryToLocationKind('Dairies, Cheeses')).toBe('fridge');
    expect(mapCategoryToLocationKind('Fresh vegetables')).toBe('fridge');
  });
  it('defaults to the pantry', () => {
    expect(mapCategoryToLocationKind('Breakfast cereals')).toBe('pantry');
    expect(mapCategoryToLocationKind(null)).toBe('pantry');
  });
});

describe('parseOpenFoodFactsProduct', () => {
  it('maps a found product', () => {
    const result = parseOpenFoodFactsProduct(
      { status: 1, product: { product_name: 'Cheddar Cheese', brands: 'BrandA, BrandB', categories: 'Dairies, Cheeses' } },
      '0123456789012',
    );
    expect(result).toEqual({
      barcode: '0123456789012',
      found: true,
      name: 'Cheddar Cheese',
      brand: 'BrandA',
      category: 'Cheeses',
      suggestedLocationKind: 'fridge',
    });
  });

  it('reports not-found for status 0', () => {
    const result = parseOpenFoodFactsProduct({ status: 0 }, '999');
    expect(result.found).toBe(false);
    expect(result.name).toBeNull();
    expect(result.suggestedLocationKind).toBe('pantry');
  });
});
