/**
 * 보급 상점 처리.
 *
 * 전투 밖에서만 호출된다 — 전투 중 포인트로 무언가를 사는 경로는 만들지 않는다.
 * 포인트와 보급품은 영구 편성(PairBond)에 붙어 공략 사이에도 유지된다.
 */

import { findItem } from '../config/items';
import { findShopEntry, shopRows, type ShopRow } from '../config/shop';
import type { ItemStack, PairBond } from '../types';
import { addItem, quantityOf } from './items';

export interface PurchaseResult {
  ok: boolean;
  reason?: string;
  points: number;
  inventory: ItemStack[];
  /** 사람이 읽는 결과 문장 */
  message: string;
}

/** 이 편성이 지금 살 수 있는 목록 */
export function availableRows(bond: PairBond): Array<ShopRow & { affordable: boolean; owned: number }> {
  return shopRows().map((row) => ({
    ...row,
    owned: quantityOf(bond.inventory ?? [], row.itemId),
    affordable: (bond.points ?? 0) >= row.price,
  }));
}

export function purchase(bond: PairBond, itemId: string, quantity = 1): PurchaseResult {
  const inventory = bond.inventory ?? [];
  const points = bond.points ?? 0;
  const entry = findShopEntry(itemId);
  const item = findItem(itemId);

  if (!entry || !item) {
    return { ok: false, reason: '취급하지 않는 품목입니다.', points, inventory, message: '' };
  }
  if (quantity < 1) {
    return { ok: false, reason: '수량이 올바르지 않습니다.', points, inventory, message: '' };
  }

  const owned = quantityOf(inventory, itemId);
  if (entry.limit !== null && owned + quantity > entry.limit) {
    return {
      ok: false,
      reason: `보유 한도를 넘습니다. (한도 ${entry.limit}개 · 현재 ${owned}개)`,
      points,
      inventory,
      message: '',
    };
  }

  const cost = entry.price * quantity;
  if (points < cost) {
    return {
      ok: false,
      reason: `포인트가 부족합니다. (필요 ${cost}P · 보유 ${points}P)`,
      points,
      inventory,
      message: '',
    };
  }

  return {
    ok: true,
    points: points - cost,
    inventory: addItem(inventory, itemId, quantity),
    message: `${item.nameKo} ${quantity}개 구매 — ${cost}P 차감`,
  };
}

/** 구매 결과를 편성에 반영한다 */
export function withPurchase(bond: PairBond, result: PurchaseResult): PairBond {
  if (!result.ok) return bond;
  return { ...bond, points: result.points, inventory: result.inventory };
}

/** 되팔기 — 구매가의 절반만 돌려준다 */
export const REFUND_RATIO = 0.5;

export function refund(bond: PairBond, itemId: string): PurchaseResult {
  const inventory = bond.inventory ?? [];
  const points = bond.points ?? 0;
  const entry = findShopEntry(itemId);
  const item = findItem(itemId);

  if (!entry || !item) {
    return { ok: false, reason: '취급하지 않는 품목입니다.', points, inventory, message: '' };
  }
  if (quantityOf(inventory, itemId) <= 0) {
    return { ok: false, reason: '보유하고 있지 않습니다.', points, inventory, message: '' };
  }

  const back = Math.floor(entry.price * REFUND_RATIO);
  return {
    ok: true,
    points: points + back,
    inventory: addItem(inventory, itemId, -1),
    message: `${item.nameKo} 1개 반납 — ${back}P 환급`,
  };
}
