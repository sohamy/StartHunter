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
import type { CustomAttack, EnemyState } from '../types';

export interface PhaseResult {
  phase: number;
  label: string;
  changed: boolean;
}

/* ── 커스텀 공격 ───────────────────────────────────────
   운영진이 만든 공격을 엔진이 쓰는 패턴 정의로 바꾼다.
   덕분에 라운드 처리 쪽은 프리셋 패턴과 커스텀 공격을 구분하지 않는다. */

/** 예고 패턴의 id — 본체와 짝을 이룬다 */
function telegraphId(attack: CustomAttack): string {
  return `custom:${attack.id}:warn`;
}

function attackId(attack: CustomAttack): string {
  return `custom:${attack.id}`;
}

/** 실제로 때리는 패턴 */
export function attackToPattern(attack: CustomAttack): PatternDefinition {
  return {
    id: attackId(attack),
    label: attack.name || '이름 없는 공격',
    labelKo: attack.name || '이름 없는 공격',
    description: attack.description,
    shape: attack.aoe ? 'AOE' : attack.powerRatio > 0 ? 'SINGLE' : 'BUFF',
    powerRatio: attack.powerRatio,
    applyStatusIds: attack.applyStatusIds,
    selfStatusIds: attack.selfStatusIds,
    revealed: attack.revealed,
  };
}

/** 예고 단계 — 이 라운드에는 때리지 않고 다음을 알린다 */
function attackToTelegraph(attack: CustomAttack): PatternDefinition {
  return {
    id: telegraphId(attack),
    label: `${attack.name || '공격'} 예고`,
    labelKo: `${attack.name || '공격'} 예고`,
    description: attack.telegraphMessage || attack.description,
    shape: 'TELEGRAPH',
    powerRatio: 0,
    applyStatusIds: [],
    selfStatusIds: [],
    revealed: true,
    telegraphMessage: attack.telegraphMessage || `${attack.name} 준비 중`,
    telegraphRounds: attack.telegraphRounds,
    resolvesTo: attackId(attack),
  };
}

/** 이 페이즈에서 쓸 수 있는 커스텀 공격 */
function attacksForPhase(enemy: EnemyState): CustomAttack[] {
  return (enemy.attacks ?? []).filter(
    (attack) => attack.phases.length === 0 || attack.phases.includes(enemy.phase),
  );
}

/** 커스텀 공격과 프리셋 패턴을 같은 방법으로 찾는다 */
function resolvePattern(enemy: EnemyState, patternId: string | null): PatternDefinition | null {
  if (!patternId) return null;

  for (const attack of enemy.attacks ?? []) {
    if (patternId === attackId(attack)) return attackToPattern(attack);
    if (patternId === telegraphId(attack)) return attackToTelegraph(attack);
  }
  return findPattern(patternId);
}

/** 예고를 기다리는 동안 쓰는 패턴 */
function fallbackPattern(enemy: EnemyState): PatternDefinition | null {
  const custom = attacksForPhase(enemy).filter((attack) => attack.telegraphRounds <= 0);
  if (custom.length > 0) return attackToPattern(custom[0]);
  if ((enemy.attacks ?? []).length > 0) return null;

  const set = findPatternSet(enemy.patternSetId);
  return findPattern(set?.fallbackPatternId ?? null);
}

/** HP 비율로 페이즈를 판정한다. 운영진이 수동으로 바꾼 값도 이 함수로 덮어쓰지 않는다. */
export function evaluatePhase(enemy: EnemyState): PhaseResult {
  const set = findPatternSet(enemy.patternSetId);
  if (!set || set.phaseThresholds.length === 0) {
    // 커스텀 적은 경계를 따로 두지 않는다 — 최대 페이즈 수만큼 HP 를 균등하게 나눈다
    if (enemy.maxPhase > 1) {
      const percent = enemy.maxHp > 0 ? (enemy.hp / enemy.maxHp) * 100 : 0;
      const span = 100 / enemy.maxPhase;
      const phase = Math.min(
        enemy.maxPhase,
        Math.max(1, Math.ceil((100 - percent) / span) || 1),
      );
      return { phase, label: `PHASE ${phase}`, changed: phase !== enemy.phase };
    }
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
      const telegraphed = resolvePattern(enemy, enemy.telegraph.patternId);
      const resolved = resolvePattern(enemy, telegraphed?.resolvesTo ?? null);
      return resolved ?? telegraphed;
    }
    // 예고 대기 중에는 기본 패턴으로 때운다
    return fallbackPattern(enemy);
  }

  /*
     커스텀 공격이 있으면 그것만 쓴다.
     페이즈에 묶인 목록을 라운드마다 순서대로 돌린다 — 운영진이 순서를 예측할 수 있어야 한다.
  */
  const custom = attacksForPhase(enemy);
  if (custom.length > 0) {
    const attack = custom[(Math.max(1, round) - 1) % custom.length];
    return attack.telegraphRounds > 0 ? attackToTelegraph(attack) : attackToPattern(attack);
  }
  if ((enemy.attacks ?? []).length > 0) return null;

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
