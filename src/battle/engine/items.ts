/**
 * 아이템 처리.
 *
 * 정의는 config/items.ts 에 있고, 이 파일은 그 정의를 해석해
 *   1) 지금 쓸 수 있는지 판정하고
 *   2) 무슨 일이 일어나는지 계산하고
 *   3) 보유 개수를 줄인다.
 *
 * 상태를 직접 변형하지 않고 항상 새 배열을 돌려준다.
 */

import { ITEM_RULES, allowedFor, describeItem, findItem } from '../config/items';
import { findStatus } from '../config/status';
import type {
  ActorSide,
  ItemDefinition,
  ItemStack,
  ItemUse,
  PairState,
  StatusEffect,
} from '../types';
import { isDown } from './status';

/* ── 가방 ──────────────────────────────────────────────── */

export function quantityOf(inventory: ItemStack[], itemId: string): number {
  return inventory.find((row) => row.itemId === itemId)?.quantity ?? 0;
}

/** 개수를 더한다. 0 이하로 내려가면 항목을 지운다. */
export function addItem(inventory: ItemStack[], itemId: string, delta: number): ItemStack[] {
  if (!findItem(itemId)) return inventory;

  const existing = inventory.find((row) => row.itemId === itemId);
  if (!existing) {
    if (delta <= 0) return inventory;
    return [...inventory, { itemId, quantity: Math.min(ITEM_RULES.maxQuantity, delta) }];
  }

  const quantity = Math.min(ITEM_RULES.maxQuantity, existing.quantity + delta);
  if (quantity <= 0) return inventory.filter((row) => row.itemId !== itemId);
  return inventory.map((row) => (row.itemId === itemId ? { ...row, quantity } : row));
}

export function consumeItem(inventory: ItemStack[], itemId: string): ItemStack[] {
  return addItem(inventory, itemId, -1);
}

/** 이 주체의 개인 가방. 두 사람의 가방은 섞이지 않는다. */
export function bagOf(pair: PairState, side: ActorSide): ItemStack[] {
  return (side === 'HUNTER' ? pair.hunter.inventory : pair.constellation.inventory) ?? [];
}

/** 이 주체의 가방을 갈아 끼운 새 페어 */
export function withBag(pair: PairState, side: ActorSide, inventory: ItemStack[]): PairState {
  return side === 'HUNTER'
    ? { ...pair, hunter: { ...pair.hunter, inventory } }
    : { ...pair, constellation: { ...pair.constellation, inventory } };
}

export interface InventoryRow {
  item: ItemDefinition;
  quantity: number;
  effects: string[];
}

/** 이 주체가 자기 가방에서 고를 수 있는 목록 */
export function inventoryFor(pair: PairState, side: ActorSide): InventoryRow[] {
  return bagOf(pair, side).flatMap((stack) => {
    const item = findItem(stack.itemId);
    if (!item) return [];
    if (!allowedFor(item, side, pair.affiliation)) return [];
    return [{ item, quantity: stack.quantity, effects: describeItem(item) }];
  });
}

/* ── 사용 가능 여부 ────────────────────────────────────── */

export interface ItemAvailability {
  usable: boolean;
  reason?: string;
}

export function itemAvailability(
  pair: PairState,
  side: ActorSide,
  itemId: string | null,
  hasEnemy: boolean,
  supportTarget: PairState | null,
): ItemAvailability {
  const item = findItem(itemId);
  if (!item) return { usable: false, reason: '아이템을 고르지 않았습니다' };
  if (!item.combatUsable) return { usable: false, reason: '전투 중 사용 불가' };
  if (!allowedFor(item, side, pair.affiliation)) {
    return { usable: false, reason: '이 주체가 쓸 수 없는 분류' };
  }
  if (quantityOf(bagOf(pair, side), item.id) <= 0) {
    return { usable: false, reason: '보유 개수 없음' };
  }

  const actor = side === 'HUNTER' ? pair.hunter : pair.constellation;
  if (item.apCost > actor.ap) {
    return { usable: false, reason: `행동력 부족 (필요 ${item.apCost})` };
  }
  if (item.target === 'ENEMY' && !hasEnemy) return { usable: false, reason: '대상 없음' };

  if (item.effect.revivePercent) {
    const target = supportTarget ?? pair;
    if (!isDown(target.hunter)) {
      return { usable: false, reason: '전투 불능 대상이 아닙니다' };
    }
  }

  return { usable: true };
}

/** 아이템 행동의 실제 행동력 비용 — 행동 정의가 아니라 아이템이 정한다 */
export function itemApCost(itemId: string | null): number {
  return findItem(itemId)?.apCost ?? 0;
}

/* ── 사용 결과 ─────────────────────────────────────────── */

/**
 * 아이템 효과를 계산한다.
 *
 * `healBonusRatio` 는 클래스 특성에서 오는 회복 보정이다 —
 * 이 파일은 어느 클래스가 그 보정을 주는지 알지 않는다.
 */
export function resolveItem(
  pair: PairState,
  side: ActorSide,
  itemId: string,
  target: { enemyId: string | null; supportPair: PairState | null },
  healBonusRatio = 0,
): ItemUse | null {
  const item = findItem(itemId);
  if (!item) return null;

  const effects: string[] = [];
  const healTarget = item.target === 'ALLY' ? target.supportPair ?? pair : pair;
  const actor = side === 'HUNTER' ? pair.hunter : pair.constellation;

  let healAmount = 0;
  let revive = false;

  if (item.effect.revivePercent && isDown(healTarget.hunter)) {
    revive = true;
    healAmount = Math.max(
      1,
      Math.round(healTarget.hunter.maxHp * item.effect.revivePercent * (1 + healBonusRatio)),
    );
    effects.push(`${healTarget.label} 전투 불능 복귀 (HP ${healAmount})`);
  } else if (item.effect.healPercent || item.effect.healHp) {
    const percentPart = (item.effect.healPercent ?? 0) * healTarget.hunter.maxHp;
    const flatPart = item.effect.healHp ?? 0;
    healAmount = Math.max(1, Math.round((percentPart + flatPart) * (1 + healBonusRatio)));
    effects.push(`${healTarget.label} HP +${healAmount}`);
  }

  const damage = item.effect.damage ?? 0;
  if (damage > 0) effects.push(`적에게 피해 ${damage}`);

  const applyStatusIds = item.effect.applyStatusIds ?? [];
  for (const defId of applyStatusIds) {
    const def = findStatus(defId);
    if (def) effects.push(`${def.label} 부여`);
  }

  const cureStatusIds = curable(actor.statuses, item);
  for (const defId of cureStatusIds) {
    const def = findStatus(defId);
    if (def) effects.push(`${def.label} 해제`);
  }

  const restoreAp = item.effect.restoreAp ?? 0;
  if (restoreAp > 0) effects.push(`행동력 +${restoreAp}`);

  const contractRepair = item.effect.contractRepair ?? 0;
  if (contractRepair > 0) effects.push(`계약 안정도 +${contractRepair}`);

  const stageRepair = item.effect.stageRepair ?? 0;
  if (stageRepair > 0) effects.push(`성좌 상태 ${stageRepair}단계 회복`);

  return {
    side,
    itemId: item.id,
    itemName: item.nameKo,
    targetPairId: healAmount > 0 ? healTarget.id : null,
    targetEnemyId: damage > 0 ? target.enemyId : null,
    effects: [`${item.nameKo} 사용`, ...effects],
    healAmount,
    revive,
    damage,
    applyStatusIds,
    cureStatusIds,
    restoreAp,
    contractRepair,
    stageRepair,
    apCost: item.apCost,
  };
}

/** 이 아이템이 지울 수 있는 상태이상 */
function curable(statuses: StatusEffect[], item: ItemDefinition): string[] {
  const kinds = item.effect.cureKinds ?? [];
  if (kinds.length === 0) return [];
  return statuses
    .filter((effect) => {
      const def = findStatus(effect.defId);
      return def ? kinds.includes(def.kind) : false;
    })
    .map((effect) => effect.defId);
}

export function removeStatuses(statuses: StatusEffect[], defIds: string[]): StatusEffect[] {
  if (defIds.length === 0) return statuses;
  return statuses.filter((effect) => !defIds.includes(effect.defId));
}
