/**
 * 상태 파생 계산.
 *
 * HP 나 단계 값에서 "표시용 상태"를 끌어내는 순수 함수만 둔다.
 * 기준값은 config/rules.ts 에 있다.
 */

import {
  CONSTELLATION_STAGES,
  CONTRACT_STAGES,
  INJURY_THRESHOLDS,
} from '../config/rules';
import type {
  ConstellationStage,
  ContractStage,
  HunterState,
  InjuryStage,
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

/** 성좌 상태에 따라 조정된 최대 행동력 */
export function constellationMaxAp(baseMaxAp: number, stage: ConstellationStage): number {
  return Math.max(0, baseMaxAp + CONSTELLATION_STAGES[stage].maxApDelta);
}

export function canManifest(stage: ConstellationStage): boolean {
  return CONSTELLATION_STAGES[stage].canManifest;
}
