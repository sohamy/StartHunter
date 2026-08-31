/**
 * 포인트 보상 처리.
 *
 * 규칙은 config/rewards.ts 의 데이터이고, 이 파일은 그 규칙을 적용할 뿐이다.
 * 지급 내역은 원장(BattleState.rewards)에 남는다 — 합계만 남기면 근거를 잃는다.
 *
 * 포인트는 전투 중 아무것도 사지 못한다. 전투 밖 보급 창구(engine/shop.ts)에서만 쓴다.
 */

import { findReward, type RewardReason } from '../config/rewards';
import type { ActorSide, BattleState, PairState, RewardEntry } from '../types';

export interface RewardGrant {
  pairId: string;
  /** 받는 사람. null 이면 두 사람 모두 각자 받는다 */
  side?: ActorSide | null;
  reason: string;
  label: string;
  points: number;
}

/** 지급 대상 표기 — 로그와 화면이 함께 쓴다 */
export function rewardSideLabel(side: ActorSide | null | undefined): string {
  if (side === 'HUNTER') return '헌터';
  if (side === 'CONSTELLATION') return '성좌';
  return '두 사람';
}

/**
 * 이 사람(들)의 소지금을 옮긴다.
 *
 * 소지금은 개인 소유다 — side 가 null 이면 나눠 갖는 것이 아니라
 * 두 사람이 **각자** 같은 금액을 받는다. 같이 벌었으므로 같이 받는다.
 */
export function addPointsTo(
  pair: PairState,
  side: ActorSide | null | undefined,
  amount: number,
): PairState {
  if (amount === 0) return pair;
  const next = { ...pair };
  if (side !== 'CONSTELLATION') {
    next.hunter = { ...pair.hunter, points: Math.max(0, (pair.hunter.points ?? 0) + amount) };
  }
  if (side !== 'HUNTER') {
    next.constellation = {
      ...pair.constellation,
      points: Math.max(0, (pair.constellation.points ?? 0) + amount),
    };
  }
  return next;
}

/** 규칙 하나를 이 페어에게 적용할 준비 */
export function grantFor(
  pairId: string,
  reason: RewardReason,
  override?: number,
  side: ActorSide | null = null,
): RewardGrant {
  const rule = findReward(reason);
  return {
    pairId,
    side,
    reason,
    label: rule.labelKo,
    points: override ?? rule.points,
  };
}

/** 전투가 끝났을 때 각 페어가 받는 클리어 보상 */
export function clearRewards(state: BattleState): RewardGrant[] {
  if (state.status !== 'CLEARED') return [];
  const bossFloor = state.enemies.some((enemy) => enemy.boss);
  const reason: RewardReason = bossFloor ? 'BOSS_CLEAR' : 'FLOOR_CLEAR';

  // 전멸하지 않은 페어만 받는다 — 쓰러진 채 끝난 페어는 정산에서 운영진이 판단한다.
  return state.pairs
    .filter((pair) => pair.hunter.hp > 0)
    .map((pair) => grantFor(pair.id, reason));
}

/** 원장 항목을 만든다. id 는 호출부가 준 시각과 순번으로 만든다. */
export function toEntries(grants: RewardGrant[], round: number, stamp: number): RewardEntry[] {
  return grants.map((grant, index) => ({
    id: `RW-${stamp}-${index}`,
    round,
    pairId: grant.pairId,
    side: grant.side ?? null,
    reason: grant.reason,
    label: grant.label,
    points: grant.points,
  }));
}

/** 지급을 페어 상태에 반영한다 — 받는 사람의 소지금만 오른다 */
export function applyGrants(pairs: PairState[], grants: RewardGrant[]): PairState[] {
  if (grants.length === 0) return pairs;
  return pairs.map((pair) => {
    let next = pair;
    for (const grant of grants) {
      if (grant.pairId !== pair.id) continue;
      next = addPointsTo(next, grant.side ?? null, grant.points);
    }
    return next;
  });
}

/**
 * 이 페어가 이 전투에서 받은 총액.
 * side 를 주면 그 사람이 받은 것만 센다 — 두 사람 모두를 위한 지급은 양쪽에 다 센다.
 */
export function earnedBy(state: BattleState, pairId: string, side?: ActorSide): number {
  return state.rewards
    .filter((entry) => entry.pairId === pairId)
    .filter((entry) => !side || !entry.side || entry.side === side)
    .reduce((sum, entry) => sum + entry.points, 0);
}

/** 두 사람 모두를 위한 지급 — 각자 이 금액을 받는다 */
export function earnedShared(state: BattleState, pairId: string): number {
  return state.rewards
    .filter((entry) => entry.pairId === pairId && !entry.side)
    .reduce((sum, entry) => sum + entry.points, 0);
}

/** 이 사람만 지목해 받은 금액 — 기록에 따로 남긴다 */
export function earnedOnlyBy(state: BattleState, pairId: string, side: ActorSide): number {
  return state.rewards
    .filter((entry) => entry.pairId === pairId && entry.side === side)
    .reduce((sum, entry) => sum + entry.points, 0);
}
