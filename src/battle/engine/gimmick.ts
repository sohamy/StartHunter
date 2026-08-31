/**
 * 기믹 판정.
 *
 * 파악(INSIGHT) → 해결(RESOLVE) 두 단계로 나뉜다.
 * 보정치는 캐릭터 시트의 스탯에서 나오고, 계수는 config/gimmicks.ts 에 있다.
 * 굴림 자체는 dice.ts 가 담당한다.
 */

import { POINT_BUY } from '../config/characters';
import { GIMMICK_CHECK, findGimmick, type GimmickApproach } from '../config/gimmicks';
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
  /** 이 단계에서 인정되는 접근 — 참가자에게 그대로 보여 준다 */
  approaches: GimmickApproach[];
  /** 선언이 걸린 접근. 선언이 비었으면 null 이고 보정도 붙지 않는다 */
  matched: GimmickApproach | null;
  /** 선언을 썼는데 어느 접근에도 걸리지 않았다 */
  offApproach: boolean;
}

/** 이 장치의 이 단계에서 인정되는 접근 */
export function approachesFor(gimmick: GimmickState | null, stage: GimmickStage): GimmickApproach[] {
  if (!gimmick) return [];
  return (findGimmick(gimmick.defId)?.approaches ?? []).filter((row) => row.stage === stage);
}

/**
 * 선언이 어느 접근에 걸리는지 찾는다.
 *
 * 낱말이 들어 있기만 하면 인정한다 — 문장을 해석하지 않는다.
 * 보정이 큰 접근을 먼저 본다. 최종 인정은 관리국이 한다.
 */
export function matchApproach(
  gimmick: GimmickState | null,
  stage: GimmickStage,
  note: string | null | undefined,
): GimmickApproach | null {
  const text = (note ?? '').trim();
  if (!text) return null;

  return (
    [...approachesFor(gimmick, stage)]
      .sort((a, b) => b.bonus - a.bonus)
      .find((row) => row.keywords.some((word) => text.includes(word))) ?? null
  );
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
  /** 지금까지 적은 선언 — 인정되는 접근에 걸리면 보정이 붙는다 */
  note?: string | null,
): CheckPlan {
  const def = findGimmick(gimmick.defId);
  const breakdown: string[] = [];
  let bonus = 0;

  const approaches = approachesFor(gimmick, stage);
  const matched = matchApproach(gimmick, stage, note);
  const wrote = (note ?? '').trim().length > 0;
  const offApproach = wrote && approaches.length > 0 && !matched;

  /** 접근 보정을 얹어 계획을 마무리한다 — 두 단계가 같은 규칙을 쓴다 */
  const finish = (dc: number, statBonus: number): CheckPlan => {
    let total = statBonus;
    if (matched) {
      total += matched.bonus;
      breakdown.push(`접근 「${matched.label}」 → +${matched.bonus}`);
    } else if (offApproach) {
      total += GIMMICK_CHECK.offApproachPenalty;
      breakdown.push(`인정되지 않는 접근 → ${GIMMICK_CHECK.offApproachPenalty}`);
    }
    return { stage, dc, bonus: total, breakdown, approaches, matched, offApproach };
  };

  if (stage === 'INSIGHT') {
    const rule = GIMMICK_CHECK.insight;
    const sen = statOf(hunterStats, rule.stat);
    const obs = statOf(constellationStats, rule.supportStat);
    const senBonus = Math.floor(sen * rule.statWeight);
    const obsBonus = Math.floor(obs * rule.supportWeight);

    bonus = senBonus + obsBonus;
    breakdown.push(`관찰력 ${sen} → +${senBonus}`);
    breakdown.push(`성좌 관측 ${obs} → +${obsBonus}`);

    return finish(def?.insightDc ?? 12, bonus);
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

  return finish(def?.resolveDc ?? 13, bonus);
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
    approachId: plan.matched?.id ?? null,
    approachLabel: plan.matched?.label ?? null,
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
