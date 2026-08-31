/**
 * 보급 상점.
 *
 * 포인트로 아이템을 사는 곳이다. **전투 중에는 열지 않는다** —
 * 전투 화면은 보유 포인트만 보여주고, 구매는 전투 밖(관리국 보급 창구)에서 처리한다.
 *
 * 가격을 조정하거나 품목을 늘릴 때 이 파일만 고친다.
 */

import { findItem } from './items';
import type { ItemDefinition } from '../types';

export interface ShopEntry {
  itemId: string;
  /** 1개 가격 */
  price: number;
  /** 한 페어가 한 번에 살 수 있는 최대 개수. null 이면 재고 제한 없음 */
  limit: number | null;
}

export const SHOP_ENTRIES: ShopEntry[] = [
  { itemId: 'item.medkit', price: 80, limit: 5 },
  { itemId: 'item.antidote', price: 60, limit: 5 },
  { itemId: 'item.smoke', price: 70, limit: 4 },
  { itemId: 'item.starfruit', price: 120, limit: 3 },
  { itemId: 'item.grenade', price: 180, limit: 3 },
  { itemId: 'item.lifeline', price: 260, limit: 2 },
  { itemId: 'item.censer', price: 150, limit: 3 },
  { itemId: 'item.anchor', price: 320, limit: 1 },
  { itemId: 'item.badge.government', price: 200, limit: 2 },
  { itemId: 'item.charm.guild', price: 200, limit: 2 },
];

export interface ShopRow extends ShopEntry {
  item: ItemDefinition;
}

/** 정의가 살아 있는 품목만 돌려준다 */
export function shopRows(): ShopRow[] {
  return SHOP_ENTRIES.flatMap((entry) => {
    const item = findItem(entry.itemId);
    return item ? [{ ...entry, item }] : [];
  });
}

export function findShopEntry(itemId: string): ShopEntry | null {
  return SHOP_ENTRIES.find((row) => row.itemId === itemId) ?? null;
}
