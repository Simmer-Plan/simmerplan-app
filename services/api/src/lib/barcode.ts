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

// Barcode/UPC product lookup helpers (SIM-10). Pure functions over the Open
// Food Facts product response so they can be unit tested; the router does the
// fetch.

import type { BarcodeLookupResult, StorageLocationKind } from '@simmerplan/types';

/** Best-effort storage location from a product's category text. */
export function mapCategoryToLocationKind(category: string | null): StorageLocationKind {
  const c = (category ?? '').toLowerCase();
  if (/frozen|ice cream/.test(c)) return 'freezer';
  if (/dairy|milk|cheese|yogurt|yoghurt|butter|egg|meat|poultry|seafood|fish|fresh|deli|produce|vegetable|fruit/.test(c)) {
    return 'fridge';
  }
  return 'pantry';
}

interface OffProduct {
  product_name?: string;
  brands?: string;
  categories?: string;
}

interface OffResponse {
  status?: number;
  product?: OffProduct;
}

/** Map an Open Food Facts v2 product response into a lookup result. */
export function parseOpenFoodFactsProduct(json: unknown, barcode: string): BarcodeLookupResult {
  const res = (json ?? {}) as OffResponse;
  const product = res.product;
  const found = res.status === 1 && !!product;
  if (!found || !product) {
    return { barcode, found: false, name: null, brand: null, category: null, suggestedLocationKind: 'pantry' };
  }
  const name = product.product_name?.trim() || null;
  const brand = product.brands?.split(',')[0]?.trim() || null;
  const category = product.categories?.split(',').map((s) => s.trim()).filter(Boolean).pop() ?? null;
  return {
    barcode,
    found: true,
    name,
    brand,
    category,
    suggestedLocationKind: mapCategoryToLocationKind(product.categories ?? category),
  };
}
