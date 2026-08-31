/**
 * 적 패턴과 페이즈 처리.
 *
 * 패턴은 두 갈래로 온다.
 *   1. 프리셋 패턴 세트 — config/patterns.ts 의 데이터
 *   2. 운영진이 만든 공격 목록(EnemyState.attacks) — 하나라도 있으면 이쪽만 쓴다
 *
 * 커스텀 공격에도 프리셋과 같은 조건을 붙일 수 있다.
 *   · 사용 페이즈
 *   · 라운드 주기(every · offset)
 *   · HP 비율 조건(hpBelowPercent)
 * 조건이 붙은 공격은 조건이 맞는 라운드에 목록 순서대로 우선 발동하고,
 * 조건이 없는 공격은 남은 라운드를 순서대로 돌아간다.
 *
 * 예고(telegraph)는 상태로 남아 지정된 라운드 뒤에 실제 패턴으로 바뀐다.
 */

import {
  findPattern,
  findPatternSet,
  type PatternDefinition,
  type PatternSet,
} from '../config/patterns';
import type { CustomAttack, EnemyState } from '../types';
import { newUuid } from './id';

export interface PhaseResult {
  phase: number;
  label: string;
  changed: boolean;
}

/** 페이즈 경계 계산에 필요한 최소 정보 — 템플릿과 전투 중 적 모두 넘길 수 있다 */
export interface PhaseSource {
  maxPhase: number;
  phaseCutoffs?: number[];
  patternSetId?: string | null;
}

export interface PhaseBand {
  phase: number;
  /** 이 페이즈로 인정되는 HP 비율 하한 (%) */
  minPercent: number;
  /** 상한 (%) — 위 페이즈의 하한 바로 아래 */
  maxPercent: number;
  label: string;
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

/** 발동 조건(주기 · HP)이 붙어 있는지 */
export function hasCondition(attack: CustomAttack): boolean {
  return (attack.every ?? 0) >= 2 || (attack.hpBelowPercent ?? null) !== null;
}

function hpPercentOf(hp: number, maxHp: number): number {
  return maxHp > 0 ? (hp / maxHp) * 100 : 0;
}

/** 주기 · HP 조건이 이 라운드에 맞는지 */
export function conditionMet(
  attack: CustomAttack,
  enemy: { hp: number; maxHp: number },
  round: number,
): boolean {
  const every = attack.every ?? 0;
  if (every >= 2) {
    const offset = (((attack.offset ?? 0) % every) + every) % every;
    if (Math.max(1, round) % every !== offset) return false;
  }

  const limit = attack.hpBelowPercent ?? null;
  if (limit !== null && hpPercentOf(enemy.hp, enemy.maxHp) > limit) return false;

  return true;
}

/** 조건 없는 공격을 라운드 순서대로 돌린다 — 운영진이 순서를 예측할 수 있어야 한다 */
function rotate(pool: CustomAttack[], round: number): CustomAttack | null {
  if (pool.length === 0) return null;
  return pool[(Math.max(1, round) - 1) % pool.length];
}

/** 이 라운드에 쓸 커스텀 공격. 없으면 null (그 라운드에는 아무것도 하지 않는다) */
function pickAttack(enemy: EnemyState, round: number): CustomAttack | null {
  const usable = attacksForPhase(enemy);
  if (usable.length === 0) return null;

  // 조건이 걸린 공격이 먼저다. 여러 개가 걸리면 목록에서 위에 있는 쪽이 이긴다.
  const triggered = usable.find(
    (attack) => hasCondition(attack) && conditionMet(attack, enemy, round),
  );
  if (triggered) return triggered;

  return rotate(
    usable.filter((attack) => !hasCondition(attack)),
    round,
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
  // 예고 대기 중에는 조건 없는 공격만 쓴다 — 조건이 걸린 공격을 순서 밖에서 쓰지 않는다
  const plain = attacksForPhase(enemy).filter(
    (attack) => attack.telegraphRounds <= 0 && !hasCondition(attack),
  );
  if (plain.length > 0) return attackToPattern(plain[0]);
  if ((enemy.attacks ?? []).length > 0) return null;

  const set = findPatternSet(enemy.patternSetId);
  return findPattern(set?.fallbackPatternId ?? null);
}

/* ── 페이즈 경계 ───────────────────────────────────────
   운영진이 직접 준 경계가 가장 세고, 없으면 프리셋 세트, 그것도 없으면 균등 분할이다. */

/**
 * 경계 목록을 페이즈 수에 맞게 다듬는다.
 * 부족한 경계는 남은 구간을 균등하게 나눠 채우고, 남는 값은 버린다.
 */
export function normalizeCutoffs(cutoffs: number[] | undefined, maxPhase: number): number[] {
  const need = Math.max(1, maxPhase) - 1;
  if (need <= 0) return [];

  const cleaned = (cutoffs ?? [])
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.min(100, Math.max(0, Math.round(value))))
    .sort((a, b) => b - a)
    .slice(0, need);

  const start = cleaned.length > 0 ? cleaned[cleaned.length - 1] : 100;
  const missing = need - cleaned.length;
  const span = start / (missing + 1);
  for (let index = 1; index <= missing; index += 1) {
    cleaned.push(Math.round(start - span * index));
  }
  return cleaned;
}

function bandsFromCutoffs(cutoffs: number[], maxPhase: number): PhaseBand[] {
  const phases = Math.max(1, maxPhase);
  return Array.from({ length: phases }, (_, index) => {
    const phase = index + 1;
    const minPercent = phase === phases ? 0 : cutoffs[index];
    const maxPercent = phase === 1 ? 100 : cutoffs[index - 1];
    return { phase, minPercent, maxPercent, label: `PHASE ${phase}` };
  });
}

function bandsFromSet(set: PatternSet): PhaseBand[] {
  const rows = [...set.phaseThresholds].sort((a, b) => b.minPercent - a.minPercent);
  return rows.map((row, index) => ({
    phase: row.phase,
    minPercent: row.minPercent,
    maxPercent: index === 0 ? 100 : rows[index - 1].minPercent,
    label: row.label,
  }));
}

/** 이 적의 페이즈 경계. HP 비율이 높은 페이즈부터 내려온다. */
export function phaseBands(source: PhaseSource): PhaseBand[] {
  const explicit = source.phaseCutoffs ?? [];
  if (explicit.length > 0) {
    return bandsFromCutoffs(normalizeCutoffs(explicit, source.maxPhase), source.maxPhase);
  }

  const set = findPatternSet(source.patternSetId ?? null);
  if (set && set.phaseThresholds.length > 0) return bandsFromSet(set);

  return bandsFromCutoffs(normalizeCutoffs([], source.maxPhase), source.maxPhase);
}

/** 표시용 — 페이즈 경계를 한 줄로 적는다 */
export function describePhaseBands(source: PhaseSource): string {
  const bands = phaseBands(source);
  if (bands.length <= 1) return '단일 페이즈';

  return bands
    .map((band) =>
      band.minPercent > 0
        ? `${band.label} HP ${band.minPercent}% 이상`
        : `${band.label} HP ${band.maxPercent}% 미만`,
    )
    .join(' · ');
}

/** HP 비율로 페이즈를 판정한다. 운영진이 수동으로 바꾼 값도 이 함수로 덮어쓰지 않는다. */
export function evaluatePhase(enemy: EnemyState): PhaseResult {
  const bands = phaseBands(enemy);
  if (bands.length <= 1) {
    // 페이즈가 하나면 HP 로 바꿀 것이 없다 — 운영진이 손으로 올린 값도 그대로 둔다
    return { phase: enemy.phase, label: `PHASE ${enemy.phase}`, changed: false };
  }

  const percent = hpPercentOf(enemy.hp, enemy.maxHp);
  const matched =
    bands.find((band) => percent >= band.minPercent) ?? bands[bands.length - 1];

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

  // 커스텀 공격이 있으면 그것만 쓴다
  if ((enemy.attacks ?? []).length > 0) {
    const attack = pickAttack(enemy, round);
    if (!attack) return null;
    return attack.telegraphRounds > 0 ? attackToTelegraph(attack) : attackToPattern(attack);
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
        if (hpPercentOf(enemy.hp, enemy.maxHp) > trigger.hpBelowPercent) return false;
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

/* ── 패턴 진행표 ───────────────────────────────────────
   운영진이 저장 전에 "몇 라운드에 무엇이 나오는지" 를 눈으로 확인할 수 있게 한다. */

export interface ScheduleCell {
  round: number;
  /** 발동할 공격 이름. 아무것도 안 하면 null */
  name: string | null;
  /** 예고 단계인지 */
  telegraph: boolean;
  /** 조건(주기 · HP)으로 걸린 공격인지 */
  conditional: boolean;
}

export interface PhaseSchedule extends PhaseBand {
  /** 이 페이즈를 대표하는 HP 비율 — 구간 가운데 값 */
  samplePercent: number;
  rounds: ScheduleCell[];
}

/**
 * 페이즈별 진행표를 만든다.
 *
 * HP 조건은 그 페이즈 구간의 가운데 HP 를 기준으로 판정한다 —
 * 페이즈와 HP 는 같은 축이므로 이 값이 그 페이즈의 실제 상황에 가장 가깝다.
 */
export function patternSchedule(
  source: PhaseSource & { attacks?: CustomAttack[]; maxHp?: number },
  rounds = 6,
): PhaseSchedule[] {
  const attacks = source.attacks ?? [];
  const maxHp = Math.max(1, source.maxHp ?? 100);

  return phaseBands(source).map((band) => {
    const samplePercent = Math.round((band.minPercent + band.maxPercent) / 2);
    const enemy = {
      phase: band.phase,
      attacks,
      hp: (maxHp * samplePercent) / 100,
      maxHp,
    } as EnemyState;

    return {
      ...band,
      samplePercent,
      rounds: Array.from({ length: rounds }, (_, index) => {
        const round = index + 1;
        const attack = pickAttack(enemy, round);
        return {
          round,
          name: attack ? attack.name || '이름 없는 공격' : null,
          telegraph: Boolean(attack && attack.telegraphRounds > 0),
          conditional: Boolean(attack && hasCondition(attack)),
        };
      }),
    };
  });
}

/* ── 프리셋 → 커스텀 ───────────────────────────────────
   프리셋 세트를 편집할 수 있는 공격 목록으로 펼친다.
   덕분에 운영진은 잘 짜인 보스를 불러와 필요한 부분만 고칠 수 있다. */

export interface PresetImport {
  attacks: CustomAttack[];
  phaseCutoffs: number[];
  maxPhase: number;
}

function definitionToAttack(
  definition: PatternDefinition,
  over: Partial<CustomAttack>,
): CustomAttack {
  return {
    id: newUuid(),
    name: definition.labelKo || definition.label,
    description: definition.description,
    powerRatio: definition.powerRatio,
    aoe: definition.shape === 'AOE',
    applyStatusIds: [...definition.applyStatusIds],
    selfStatusIds: [...definition.selfStatusIds],
    revealed: definition.revealed,
    telegraphRounds: 0,
    telegraphMessage: '',
    phases: [],
    every: 0,
    offset: 0,
    hpBelowPercent: null,
    ...over,
  };
}

/**
 * 프리셋 패턴 세트를 커스텀 공격 목록으로 바꾼다.
 *
 * 예고 패턴은 예고 문구 · 라운드를 그대로 물고 실제 발동 패턴 하나로 합친다 —
 * 커스텀 공격은 예고와 본체를 한 항목으로 다루기 때문이다.
 */
export function patternSetToPreset(setId: string | null): PresetImport | null {
  const set = findPatternSet(setId);
  if (!set) return null;

  const attacks: CustomAttack[] = [];
  for (const trigger of [...set.triggers].sort((a, b) => a.priority - b.priority)) {
    const definition = findPattern(trigger.patternId);
    if (!definition) continue;

    const condition: Partial<CustomAttack> = {
      phases: trigger.phase === undefined ? [] : [trigger.phase],
      every: trigger.every ?? 0,
      offset: trigger.offset ?? 0,
      hpBelowPercent: trigger.hpBelowPercent ?? null,
    };

    if (definition.shape === 'TELEGRAPH') {
      // 예고 → 본체. 본체를 찾지 못하면 예고만이라도 남긴다.
      const body = findPattern(definition.resolvesTo ?? null);
      attacks.push(
        definitionToAttack(body ?? definition, {
          ...condition,
          telegraphRounds: Math.max(1, definition.telegraphRounds ?? 1),
          telegraphMessage: definition.telegraphMessage ?? '',
        }),
      );
      continue;
    }

    attacks.push(definitionToAttack(definition, condition));
  }

  // 어느 조건에도 걸리지 않는 라운드를 메우는 기본 공격
  const fallback = findPattern(set.fallbackPatternId);
  if (fallback) attacks.push(definitionToAttack(fallback, {}));

  const bands = bandsFromSet(set);
  const maxPhase = Math.max(1, ...bands.map((band) => band.phase));

  return {
    attacks,
    phaseCutoffs: normalizeCutoffs(
      bands.filter((band) => band.minPercent > 0).map((band) => band.minPercent),
      maxPhase,
    ),
    maxPhase,
  };
}
