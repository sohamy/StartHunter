/**
 * 포인트 보상 처리.
 *
 * 규칙은 config/rewards.ts 의 데이터이고, 이 파일은 그 규칙을 적용할 뿐이다.
 * 지급 내역은 원장(BattleState.rewards)에 남는다 — 합계만 남기면 근거를 잃는다.
 *
 * 포인트는 전투 중 아무것도 사지 못한다. 전투 밖 보급 창구(engine/shop.ts)에서만 쓴다.
 */

import { findReward, type RewardReason } from '../config/rewards';
import type { BattleState, PairState, RewardEntry } from '../types';

export interface RewardGrant {
  pairId: string;
  reason: string;
  label: string;
  points: number;
}

/** 규칙 하나를 이 페어에게 적용할 준비 */
export function grantFor(pairId: string, reason: RewardReason, override?: number): RewardGrant {
  const rule = findReward(reason);
  return {
    pairId,
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
    reason: grant.reason,
    label: grant.label,
    points: grant.points,
  }));
}

/** 지급을 페어 상태에 반영한다 */
export function applyGrants(pairs: PairState[], grants: RewardGrant[]): PairState[] {
  if (grants.length === 0) return pairs;
  return pairs.map((pair) => {
    const total = grants
      .filter((grant) => grant.pairId === pair.id)
      .reduce((sum, grant) => sum + grant.points, 0);
    return total === 0 ? pair : { ...pair, points: Math.max(0, pair.points + total) };
  });
}

/** 이 페어가 이 전투에서 받은 총액 */
export function earnedBy(state: BattleState, pairId: string): number {
  return state.rewards
    .filter((entry) => entry.pairId === pairId)
    .reduce((sum, entry) => sum + entry.points, 0);
}
