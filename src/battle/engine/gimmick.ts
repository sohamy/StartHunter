/**
 * 기믹 판정.
 *
 * 파악(INSIGHT) → 해결(RESOLVE) 두 단계로 나뉜다.
 * 보정치는 캐릭터 시트의 스탯에서 나오고, 계수는 config/gimmicks.ts 에 있다.
 * 굴림 자체는 dice.ts 가 담당한다.
 */

import { POINT_BUY } from '../config/characters';
import { GIMMICK_CHECK, findGimmick } from '../config/gimmicks';
import { rollDice, type DiceResult } from './dice';
import type { GimmickCheck, GimmickStage, GimmickState, PairState } from '../types';

function statOf(stats: Record<string, number>, key: string): number {
  return stats[key] ?? POINT_BUY.baseValue;
}

export interface CheckPlan {
  stage: GimmickStage;
  dc: number;
  bonus: number;
  breakdown: string[];
}

/**
 * 판정에 붙는 보정을 계산한다.
 *
 * 전투 상태에는 스탯 원본이 없으므로 시트에서 파생된 값을 쓴다 —
 * 헌터의 관찰력은 방어력 계산과 무관하니 시트 스탯을 그대로 받아온다.
 */
export function planCheck(
  stage: GimmickStage,
  gimmick: GimmickState,
  hunterStats: Record<string, number>,
  constellationStats: Record<string, number>,
): CheckPlan {
  const def = findGimmick(gimmick.defId);
  const breakdown: string[] = [];
  let bonus = 0;

  if (stage === 'INSIGHT') {
    const rule = GIMMICK_CHECK.insight;
    const sen = statOf(hunterStats, rule.stat);
    const obs = statOf(constellationStats, rule.supportStat);
    const senBonus = Math.floor(sen * rule.statWeight);
    const obsBonus = Math.floor(obs * rule.supportWeight);

    bonus = senBonus + obsBonus;
    breakdown.push(`관찰력 ${sen} → +${senBonus}`);
    breakdown.push(`성좌 관측 ${obs} → +${obsBonus}`);

    return { stage, dc: def?.insightDc ?? 12, bonus, breakdown };
  }

  const rule = GIMMICK_CHECK.resolve;
  const luk = statOf(hunterStats, rule.stat);
  const sen = statOf(hunterStats, rule.secondStat);
  const obs = statOf(constellationStats, rule.supportStat);
  const lukBonus = Math.floor(luk * rule.statWeight);
  const senBonus = Math.floor(sen * rule.secondWeight);
  const obsBonus = Math.floor(obs * rule.supportWeight);

  bonus = lukBonus + senBonus + obsBonus;
  breakdown.push(`운 ${luk} → +${lukBonus}`);
  breakdown.push(`관찰력 ${sen} → +${senBonus}`);
  if (obsBonus > 0) breakdown.push(`성좌 관측 ${obs} → +${obsBonus}`);

  return { stage, dc: def?.resolveDc ?? 13, bonus, breakdown };
}

/** 계획대로 주사위를 굴려 판정 결과를 만든다 */
export function rollCheck(plan: CheckPlan): GimmickCheck | null {
  const result: DiceResult | null = rollDice(GIMMICK_CHECK.dice);
  if (!result) return null;

  const total = result.total + plan.bonus;
  const critical = result.rolls.every((value) => value === result.sides);

  return {
    stage: plan.stage,
    expression: GIMMICK_CHECK.dice,
    rolls: result.rolls,
    bonus: plan.bonus,
    breakdown: plan.breakdown,
    total,
    dc: plan.dc,
    success: critical || total >= plan.dc,
    critical,
  };
}

/** 판정 결과가 만들어내는 진행량 */
export function progressFrom(check: GimmickCheck | null): number {
  if (!check || check.stage !== 'RESOLVE' || !check.success) return 0;
  return check.critical ? GIMMICK_CHECK.progressOnCritical : GIMMICK_CHECK.progressOnSuccess;
}

/** 참가자가 지금 시도할 수 있는 단계 */
export function availableStage(gimmick: GimmickState | null, pair: PairState): GimmickStage | null {
  if (!gimmick || gimmick.status !== 'ACTIVE') return null;
  // 파악은 페어 단위로 인정한다 — 다른 페어가 파악해도 전체가 공유한다
  return gimmick.identified ? 'RESOLVE' : 'INSIGHT';
}

/** 파악 전/후에 참가자에게 보여줄 설명 */
export function gimmickBrief(gimmick: GimmickState): { text: string; revealed: boolean } {
  const def = findGimmick(gimmick.defId);
  if (!def) return { text: gimmick.description, revealed: gimmick.identified };

  return gimmick.identified
    ? { text: `${def.description}\n${def.insightReveal}`, revealed: true }
    : { text: def.unknownDescription, revealed: false };
}

export function declarationValid(note: string | null): boolean {
  if (!GIMMICK_CHECK.requireDeclaration) return true;
  return (note ?? '').trim().length >= GIMMICK_CHECK.declarationMinLength;
}
