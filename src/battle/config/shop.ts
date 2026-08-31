/**
 * 보급 상점.
 *
 * 포인트로 아이템을 사는 곳이다. **전투 중에는 열지 않는다** —
 * 전투 화면은 보유 포인트만 보여주고, 구매는 전투 밖(관리국 보급 창구)에서 처리한다.
 *
 * 가격을 조정하거나 품목을 늘릴 때 이 파일만 고친다.
 */

import { applyItemCatalog, findItem } from './items';
import type { ItemDefinition, ShopItemRecord } from '../types';

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
  { itemId: 'item.stim', price: 90, limit: 3 },
  // 영구 강화 — 값이 비싼 대신 시트에 남는다. 상한은 아이템 정의(statCap)가 정한다.
  { itemId: 'item.train.str', price: 400, limit: 2 },
  { itemId: 'item.train.vit', price: 400, limit: 2 },
  { itemId: 'item.train.agi', price: 400, limit: 2 },
  { itemId: 'item.train.authority', price: 400, limit: 2 },
  { itemId: 'item.train.divinity', price: 400, limit: 2 },
];

export interface ShopRow extends ShopEntry {
  item: ItemDefinition;
}

let listings: ShopItemRecord[] = [];

/**
 * 저장소에서 읽어 온 진열을 싣는다. 화면 진입 때 한 번 부른다.
 * 운영진이 만든 품목 정의도 같이 실어 전투 판정에서 찾을 수 있게 한다.
 */
export function applyShopCatalog(rows: ShopItemRecord[]): void {
  listings = rows;
  applyItemCatalog(rows.flatMap((row) => (row.item ? [row.item] : [])));
}

export function shopCatalog(): ShopItemRecord[] {
  return listings;
}

/** 기본 목록에 운영진 진열을 얹은 결과 — 화면과 구매 판정이 함께 쓴다 */
export function shopEntries(): ShopEntry[] {
  const byId = new Map<string, ShopEntry>();
  for (const entry of SHOP_ENTRIES) byId.set(entry.itemId, { ...entry });

  const order = new Map<string, number>();
  SHOP_ENTRIES.forEach((entry, index) => order.set(entry.itemId, index));

  for (const row of listings) {
    if (!row.active) {
      byId.delete(row.itemId);
      continue;
    }
    byId.set(row.itemId, { itemId: row.itemId, price: row.price, limit: row.limit });
    // 진열 순서는 운영진이 정한 값이 앞선다 — 기본 목록 뒤가 아니라 지정한 자리에 놓는다
    order.set(row.itemId, row.sort);
  }

  return [...byId.values()].sort(
    (a, b) => (order.get(a.itemId) ?? 0) - (order.get(b.itemId) ?? 0),
  );
}

/** 정의가 살아 있는 품목만 돌려준다 */
export function shopRows(): ShopRow[] {
  return shopEntries().flatMap((entry) => {
    const item = findItem(entry.itemId);
    return item ? [{ ...entry, item }] : [];
  });
}

export function findShopEntry(itemId: string): ShopEntry | null {
  return shopEntries().find((row) => row.itemId === itemId) ?? null;
}
