/**
 * 상태 파생 계산.
 *
 * HP 나 단계 값에서 "표시용 상태"를 끌어내는 순수 함수만 둔다.
 * 기준값은 config/rules.ts 에 있다.
 */

import {
  CONSTELLATION_STAGES,
  CONTRACT_RULES,
  CONTRACT_STAGES,
  INJURY_THRESHOLDS,
} from '../config/rules';
import { findStatus, type StatusDefinition, type StatusModifiers } from '../config/status';
import type {
  ConstellationStage,
  ContractStage,
  ContractState,
  HunterState,
  InjuryStage,
  StatusEffect,
} from '../types';

export type Tone = 'ok' | 'warn' | 'danger' | 'critical' | 'offline';

export interface StageView {
  stage: string;
  label: string;
  labelKo: string;
  tone: Tone;
}

export function injuryOf(hunter: HunterState): StageView & { stage: InjuryStage } {
  const percent = hunter.maxHp > 0 ? (hunter.hp / hunter.maxHp) * 100 : 0;
  const matched =
    INJURY_THRESHOLDS.find((row) => percent >= row.minPercent && row.minPercent > 0) ??
    INJURY_THRESHOLDS[INJURY_THRESHOLDS.length - 1];

  return {
    stage: matched.stage,
    label: matched.stage,
    labelKo: matched.label,
    tone: matched.tone,
  };
}

export function isDown(hunter: HunterState): boolean {
  return hunter.hp <= 0;
}

export function constellationView(stage: ConstellationStage): StageView {
  const row = CONSTELLATION_STAGES[stage];
  return { stage, label: row.label, labelKo: row.labelKo, tone: row.tone };
}

export function contractView(stage: ContractStage): StageView {
  const row = CONTRACT_STAGES[stage];
  return { stage, label: row.label, labelKo: row.labelKo, tone: row.tone };
}

/** 계약 안정도 값에서 단계를 끌어낸다 — 값이 곧 단계다. */
export function contractStageOf(value: number): ContractStage {
  const rows = Object.entries(CONTRACT_STAGES) as Array<[ContractStage, { minValue: number }]>;
  const sorted = rows.sort((a, b) => b[1].minValue - a[1].minValue);
  const matched = sorted.find(([, row]) => value >= row.minValue);
  return matched ? matched[0] : 'BROKEN';
}

/** 값을 범위 안으로 자르고 단계를 다시 계산한 계약 상태 */
export function contractFromValue(value: number): ContractState {
  const clamped = Math.max(
    CONTRACT_RULES.minValue,
    Math.min(CONTRACT_RULES.maxValue, Math.round(value)),
  );
  return { value: clamped, stage: contractStageOf(clamped) };
}

/** 계약 단계가 권능 효과에 곱하는 배율 */
export function contractPowerMultiplier(stage: ContractStage): number {
  return CONTRACT_STAGES[stage].powerMultiplier;
}

/** 성좌 상태에 따라 조정된 최대 행동력 */
export function constellationMaxAp(baseMaxAp: number, stage: ConstellationStage): number {
  return Math.max(0, baseMaxAp + CONSTELLATION_STAGES[stage].maxApDelta);
}

/** 성좌 상태 단계 순서 — 위에서 아래로 나빠진다 */
export const CONSTELLATION_STAGE_ORDER: ConstellationStage[] = [
  'STABLE',
  'UNSTABLE',
  'CRACKED',
  'COLLAPSE',
  'LOST',
];

/** 단계를 이만큼 내린다(양수) 또는 올린다(음수). 범위를 넘지 않는다. */
export function shiftStage(stage: ConstellationStage, steps: number): ConstellationStage {
  const index = CONSTELLATION_STAGE_ORDER.indexOf(stage);
  if (index < 0) return stage;
  const next = Math.max(0, Math.min(CONSTELLATION_STAGE_ORDER.length - 1, index + steps));
  return CONSTELLATION_STAGE_ORDER[next];
}

/**
 * 현신 가능 여부.
 * 성좌의 존재 상태와 계약 단계 둘 다 통과해야 한다.
 */
export function canManifest(stage: ConstellationStage, contractStage?: ContractStage): boolean {
  if (!CONSTELLATION_STAGES[stage].canManifest) return false;
  if (contractStage && !CONTRACT_STAGES[contractStage].canManifest) return false;
  return true;
}

/* ── 상태이상 ──────────────────────────────────────────
   정의는 config/status.ts 에 있고, 여기서는 인스턴스를 다룬다. */

/** 상태이상 목록을 하나의 보정치로 합산한다. 비율은 중첩 수만큼 더해진다. */
export function aggregateModifiers(statuses: StatusEffect[]): StatusModifiers {
  const total: StatusModifiers = {};

  for (const effect of statuses) {
    const def = findStatus(effect.defId);
    if (!def) continue;

    // 중첩 수와 부여 시점의 배율(권능 배율 등)을 함께 곱한다.
    const weight = Math.max(1, effect.stacks) * (effect.scale ?? 1);
    const mods = def.modifiers;

    if (mods.attackUp) total.attackUp = (total.attackUp ?? 0) + mods.attackUp * weight;
    if (mods.attackDown) total.attackDown = (total.attackDown ?? 0) + mods.attackDown * weight;
    if (mods.defenseDown) total.defenseDown = (total.defenseDown ?? 0) + mods.defenseDown * weight;
    if (mods.damageTaken) total.damageTaken = (total.damageTaken ?? 0) + mods.damageTaken * weight;
    if (mods.damageReduction) {
      total.damageReduction = (total.damageReduction ?? 0) + mods.damageReduction * weight;
    }
    if (mods.dotDamage) total.dotDamage = (total.dotDamage ?? 0) + Math.round(mods.dotDamage * weight);
    if (mods.blockAction) total.blockAction = true;
    if (mods.healBlock) total.healBlock = true;
  }

  return total;
}

/**
 * 상태이상을 부여한다.
 * 중첩 불가면 지속시간만 갱신하고, 중첩 가능하면 최대 중첩까지 쌓는다.
 */
export function applyStatus(
  statuses: StatusEffect[],
  defId: string,
  sourceLabel: string,
  scale = 1,
  durationBonus = 0,
): StatusEffect[] {
  const def = findStatus(defId);
  if (!def) return statuses;

  // 권역 특성이 늘리고 헌터의 의지가 깎는다. 부여 자체가 무효가 되지는 않으므로 최소 1 라운드는 남긴다.
  const duration = Math.max(1, def.duration + durationBonus);

  const existing = statuses.find((effect) => effect.defId === defId);
  if (!existing) {
    return [...statuses, { defId, remainingRounds: duration, stacks: 1, sourceLabel, scale }];
  }

  return statuses.map((effect) => {
    if (effect.defId !== defId) return effect;
    return {
      ...effect,
      // 지속시간은 항상 갱신한다 (더 긴 쪽을 유지)
      remainingRounds: Math.max(effect.remainingRounds, duration),
      stacks: def.stackable ? Math.min(def.maxStacks, effect.stacks + 1) : effect.stacks,
      sourceLabel,
      // 더 강하게 건 쪽을 유지한다
      scale: Math.max(effect.scale ?? 1, scale),
    };
  });
}

export interface StatusTickResult {
  statuses: StatusEffect[];
  expired: StatusDefinition[];
}

/** 라운드 종료 처리 — 지속시간을 1 줄이고 만료된 항목을 제거한다. */
export function tickStatuses(statuses: StatusEffect[]): StatusTickResult {
  const next: StatusEffect[] = [];
  const expired: StatusDefinition[] = [];

  for (const effect of statuses) {
    const remaining = effect.remainingRounds - 1;
    if (remaining > 0) {
      next.push({ ...effect, remainingRounds: remaining });
      continue;
    }
    const def = findStatus(effect.defId);
    if (def) expired.push(def);
  }

  return { statuses: next, expired };
}

export interface StatusView {
  defId: string;
  label: string;
  labelKo: string;
  tone: Tone;
  remainingRounds: number;
  stacks: number;
  description: string;
}

const STATUS_TONE: Record<StatusDefinition['kind'], Tone> = {
  BUFF: 'ok',
  DEBUFF: 'warn',
  DOT: 'danger',
  CONTROL: 'critical',
};

export function statusViews(statuses: StatusEffect[]): StatusView[] {
  return statuses.flatMap((effect) => {
    const def = findStatus(effect.defId);
    if (!def) return [];
    return [
      {
        defId: def.id,
        label: def.label,
        labelKo: def.labelKo,
        tone: STATUS_TONE[def.kind],
        remainingRounds: effect.remainingRounds,
        stacks: effect.stacks,
        description: def.description,
      },
    ];
  });
}

export function isActionBlocked(statuses: StatusEffect[]): boolean {
  return aggregateModifiers(statuses).blockAction === true;
}
