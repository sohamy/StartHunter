/**
 * 무엇을 고를 수 있는가.
 *
 * 행동력 · 쿨타임 · 계약 단계 · 가방을 함께 본다.
 * 고를 수 없는 이유는 문장으로 돌려준다 — 화면이 그대로 보여 주기 위해서다.
 */

import { CURRENT_PHASE } from '../../config/rules';
import type { ActionDefinition, ActorSide, GimmickState, PairState } from '../../types';
import { inventoryFor, itemApCost } from '../items';
import { findSkillRuntime, skillAvailability } from '../skills';
import { aggregateModifiers, canManifest, isDown } from '../status';


/* ── 선택 가능 여부 ────────────────────────────────────── */

export interface Availability {
  usable: boolean;
  reason?: string;
}

/** 이 주체가 이번 라운드에 고른 아이템 */
export function submittedItemId(pair: PairState, side: ActorSide): string | null {
  return side === 'HUNTER'
    ? pair.submission.hunterItemId
    : pair.submission.constellationItemId;
}

/**
 * 이 행동이 실제로 쓰는 행동력.
 * 아이템 행동은 행동 정의가 아니라 고른 아이템이 비용을 정한다.
 */
export function apCostOf(action: ActionDefinition, pair: PairState): number {
  if (action.kind !== 'ITEM') return action.apCost;
  const itemId = submittedItemId(pair, action.side);
  return itemId ? itemApCost(itemId) : action.apCost;
}

export function actionAvailability(
  action: ActionDefinition,
  pair: PairState,
  hasTarget: boolean,
  /**
   * 이 층의 기믹. 없거나 이미 끝났으면 기믹 수행을 고를 수 없다.
   * 넘기지 않으면 확인하지 않는다 — 기믹을 모르는 화면도 이 함수를 쓴다.
   */
  gimmick?: GimmickState | null,
): Availability {
  if (action.implementedIn > CURRENT_PHASE) {
    return { usable: false, reason: '아직 구현되지 않은 행동' };
  }

  const actor = action.side === 'HUNTER' ? pair.hunter : pair.constellation;
  const apCost = apCostOf(action, pair);
  if (apCost > actor.ap) {
    return { usable: false, reason: `행동력 부족 (필요 ${apCost})` };
  }

  // 커스텀 스킬이면 쿨타임과 남은 사용 횟수를 확인한다.
  const skill = findSkillRuntime(pair, action.side, action.id);
  if (skill) {
    const availability = skillAvailability(skill);
    if (!availability.usable) return availability;
  }

  if (action.side === 'HUNTER' && isDown(pair.hunter) && action.kind !== 'WAIT') {
    return { usable: false, reason: '전투 불능' };
  }

  if (aggregateModifiers(actor.statuses).blockAction && action.kind !== 'WAIT') {
    return { usable: false, reason: '행동 불가 상태' };
  }

  // 아이템 행동은 "쓸 수 있는 물건이 가방에 있는가"까지가 행동 선택 조건이다.
  // 어떤 아이템을 쓸지는 선택 후에 고르므로, 개별 아이템 검사는 확정 단계에서 한다.
  if (action.kind === 'ITEM') {
    const rows = inventoryFor(pair, action.side).filter(
      (row) => row.item.combatUsable && row.quantity > 0,
    );
    if (rows.length === 0) {
      return { usable: false, reason: '쓸 수 있는 아이템이 없습니다' };
    }
    if (rows.every((row) => row.item.apCost > actor.ap)) {
      return { usable: false, reason: '행동력이 모자라 쓸 아이템이 없습니다' };
    }
  }

  if (action.side === 'CONSTELLATION') {
    if (pair.constellation.stage === 'LOST' && action.kind !== 'WAIT') {
      return { usable: false, reason: '성좌 소멸' };
    }
    if (action.kind === 'MANIFEST' || action.kind === 'FULL_MANIFEST') {
      if (!canManifest(pair.constellation.stage, pair.contract.stage)) {
        return { usable: false, reason: '현재 성좌 · 계약 상태로는 현신 불가' };
      }
      const uses =
        action.kind === 'MANIFEST'
          ? pair.constellation.manifestUses.partial
          : pair.constellation.manifestUses.full;
      if (uses !== null && uses <= 0) {
        return { usable: false, reason: '현신 사용 횟수 소진' };
      }
    }
  }

  if (action.kind === 'GIMMICK' && gimmick !== undefined) {
    if (!gimmick) return { usable: false, reason: '이 층에는 장치가 없습니다' };
    if (gimmick.status !== 'ACTIVE') {
      return { usable: false, reason: gimmick.status === 'CLEARED' ? '이미 해제됨' : '해제 실패' };
    }
  }

  if (action.target === 'ENEMY' && !hasTarget) {
    return { usable: false, reason: '대상 없음' };
  }

  return { usable: true };
}

