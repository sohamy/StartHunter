/**
 * 적 패턴과 페이즈 처리.
 *
 * 패턴 선택 규칙은 config/patterns.ts 의 데이터다.
 * 예고(telegraph)는 상태로 남아 지정된 라운드 뒤에 실제 패턴으로 바뀐다.
 */

import {
  findPattern,
  findPatternSet,
  type PatternDefinition,
} from '../config/patterns';
import type { EnemyState } from '../types';

export interface PhaseResult {
  phase: number;
  label: string;
  changed: boolean;
}

/** HP 비율로 페이즈를 판정한다. 운영진이 수동으로 바꾼 값도 이 함수로 덮어쓰지 않는다. */
export function evaluatePhase(enemy: EnemyState): PhaseResult {
  const set = findPatternSet(enemy.patternSetId);
  if (!set || set.phaseThresholds.length === 0) {
    return { phase: enemy.phase, label: `PHASE ${enemy.phase}`, changed: false };
  }

  const percent = enemy.maxHp > 0 ? (enemy.hp / enemy.maxHp) * 100 : 0;
  const matched =
    set.phaseThresholds.find((row) => percent >= row.minPercent) ??
    set.phaseThresholds[set.phaseThresholds.length - 1];

  return {
    phase: matched.phase,
    label: matched.label,
    changed: matched.phase !== enemy.phase,
  };
}

/**
 * 이 라운드에 적이 사용할 패턴을 고른다.
 * 예고가 진행 중이면 그 예고를 우선 처리한다.
 */
export function selectPattern(enemy: EnemyState, round: number): PatternDefinition | null {
  // 예고가 끝났으면 예고된 패턴이 발동한다
  if (enemy.telegraph) {
    if (enemy.telegraph.roundsLeft <= 0) {
      const telegraphed = findPattern(enemy.telegraph.patternId);
      const resolved = findPattern(telegraphed?.resolvesTo ?? null);
      return resolved ?? telegraphed;
    }
    // 예고 대기 중에는 기본 패턴으로 때운다
    const set = findPatternSet(enemy.patternSetId);
    return findPattern(set?.fallbackPatternId ?? null);
  }

  const set = findPatternSet(enemy.patternSetId);
  if (!set) return null;

  const candidates = [...set.triggers]
    .sort((a, b) => a.priority - b.priority)
    .filter((trigger) => {
      if (trigger.phase !== undefined && trigger.phase !== enemy.phase) return false;
      if (trigger.every !== undefined) {
        const offset = trigger.offset ?? 0;
        if (round % trigger.every !== offset % trigger.every) return false;
      }
      if (trigger.hpBelowPercent !== undefined) {
        const percent = enemy.maxHp > 0 ? (enemy.hp / enemy.maxHp) * 100 : 0;
        if (percent > trigger.hpBelowPercent) return false;
      }
      return true;
    });

  const chosen = candidates[0];
  return findPattern(chosen?.patternId ?? set.fallbackPatternId);
}

/** 다음 라운드에 참가자에게 보여줄 패턴 이름 */
export function nextPatternLabel(enemy: EnemyState, round: number): string {
  if (enemy.telegraph) return enemy.telegraph.label;
  const pattern = selectPattern(enemy, round);
  if (!pattern) return 'UNKNOWN';
  return pattern.revealed ? pattern.label : 'UNKNOWN';
}

/** 운영진 전용 — 공개 여부와 무관하게 다음 패턴을 확인한다 */
export function nextPatternAdmin(enemy: EnemyState, round: number): string {
  if (enemy.telegraph) return enemy.telegraph.label;
  return selectPattern(enemy, round)?.label ?? 'UNKNOWN';
}
