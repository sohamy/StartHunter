/**
 * 보급 상점 처리.
 *
 * 전투 밖에서만 호출된다 — 전투 중 포인트로 무언가를 사는 경로는 만들지 않는다.
 * 소지금과 가방은 **개인 소유**다 (CharacterSheet.points · inventory).
 * 공략 사이에도 유지되며, 페어와 나누지 않는다.
 */

import { ITEM_RULES, allowedFor, findItem, statGainOf, statLabel } from '../config/items';
import { findShopEntry, shopRows, type ShopRow } from '../config/shop';
import type { ActorSide, Affiliation, ItemStack, StatBlock } from '../types';
import { addItem, quantityOf } from './items';

/**
 * 지갑 한 벌. 시트가 그대로 이 모양이라 시트를 그냥 넘겨도 된다 —
 * 상점 계산은 소지금과 가방만 알면 되고, 누구의 것인지는 알 필요가 없다.
 */
export interface Wallet {
  points?: number;
  inventory?: ItemStack[];
}

export interface PurchaseResult {
  ok: boolean;
  reason?: string;
  points: number;
  inventory: ItemStack[];
  /** 사람이 읽는 결과 문장 */
  message: string;
}

/** 이 사람이 지금 살 수 있는 목록 */
export function availableRows(
  wallet: Wallet,
): Array<ShopRow & { affordable: boolean; owned: number }> {
  return shopRows().map((row) => ({
    ...row,
    owned: quantityOf(wallet.inventory ?? [], row.itemId),
    affordable: (wallet.points ?? 0) >= row.price,
  }));
}

export function purchase(wallet: Wallet, itemId: string, quantity = 1): PurchaseResult {
  const inventory = wallet.inventory ?? [];
  const points = wallet.points ?? 0;
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

/** 구매 결과를 지갑 주인에게 반영한다 */
export function withPurchase<T extends Wallet>(owner: T, result: PurchaseResult): T {
  if (!result.ok) return owner;
  return { ...owner, points: result.points, inventory: result.inventory };
}

/** 되팔기 — 구매가의 절반만 돌려준다 */
export const REFUND_RATIO = 0.5;

export function refund(wallet: Wallet, itemId: string): PurchaseResult {
  const inventory = wallet.inventory ?? [];
  const points = wallet.points ?? 0;
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

/* ── 영구 강화 ─────────────────────────────────────────
   강화 아이템은 전투 밖에서만 쓴다. 쓰면 가방에서 하나 빠지고
   시트의 statBonus 가 오른다 — 배분 점수와 따로 쌓이는 값이다.
   상한(statCap)은 아이템 정의가 정하고, 운영진이 진열에서 고친다. */

export interface UseSupplyResult {
  ok: boolean;
  reason?: string;
  statBonus: StatBlock;
  inventory: ItemStack[];
  message: string;
}

/** 강화 아이템을 쓰는 사람 — 시트가 그대로 이 모양이다 */
export interface Trainee {
  side: ActorSide;
  affiliation: Affiliation;
  inventory?: ItemStack[];
  statBonus?: StatBlock | null;
}

export function useSupply(owner: Trainee, itemId: string): UseSupplyResult {
  const inventory = owner.inventory ?? [];
  const statBonus: StatBlock = { ...(owner.statBonus ?? {}) };
  const item = findItem(itemId);
  const gain = statGainOf(item);

  const fail = (reason: string): UseSupplyResult => ({
    ok: false,
    reason,
    statBonus,
    inventory,
    message: '',
  });

  if (!item) return fail('취급하지 않는 품목입니다.');
  if (!gain) return fail('여기서 쓸 수 있는 품목이 아닙니다.');
  if (item.combatUsable) return fail('전투에서 쓰는 품목입니다.');
  if (!allowedFor(item, owner.side, owner.affiliation)) {
    return fail('이 주체가 쓸 수 없는 분류입니다.');
  }
  if (quantityOf(inventory, itemId) <= 0) return fail('보유하고 있지 않습니다.');

  const cap = item.effect.statCap ?? null;
  const lines: string[] = [];
  for (const [key, amount] of Object.entries(gain)) {
    const next = (statBonus[key] ?? 0) + amount;
    if (cap !== null && next > cap) {
      return fail(`${statLabel(key)} 강화 상한을 넘습니다. (상한 +${cap} · 지금 +${statBonus[key] ?? 0})`);
    }
    statBonus[key] = next;
    lines.push(`${statLabel(key)} +${amount}`);
  }

  return {
    ok: true,
    statBonus,
    inventory: addItem(inventory, itemId, -1),
    message: `${item.nameKo} 사용 — ${lines.join(' · ')}`,
  };
}

/* ── 선물 ──────────────────────────────────────────────
   활동명으로 상대를 찾아 소지금이나 보급품을 넘긴다.
   값 판정은 서버(shop_gift)가 하고, 여기 있는 것은 화면이 미리 막기 위한 규칙이다. */

/** 받는 쪽이 이 아이템을 더 받을 수 있는 최대 개수 */
export function giftRoom(receiverInventory: ItemStack[], itemId: string): number {
  const entry = findShopEntry(itemId);
  const owned = quantityOf(receiverInventory, itemId);
  const ceiling = entry?.limit ?? ITEM_RULES.maxQuantity;
  return Math.max(0, Math.min(ceiling, ITEM_RULES.maxQuantity) - owned);
}
