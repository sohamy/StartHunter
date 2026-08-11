/**
 * 전투 규칙 수치.
 *
 * 밸런스 조정은 이 파일만 수정하면 되도록 유지한다.
 * 엔진과 UI 는 여기서 값을 읽어 쓰고, 숫자를 직접 적지 않는다.
 */

import type { ConstellationStage, ContractStage, InjuryStage } from '../types';

/** 현재 구현 단계. 이 값보다 큰 implementedIn 을 가진 행동은 선택할 수 없다. */
export const CURRENT_PHASE = 1;

export const SCHEMA_VERSION = 1;

export const AP_RULES = {
  hunterMaxAp: 5,
  constellationMaxAp: 5,
  /** 라운드 시작 시 회복량 */
  recoveryPerRound: 2,
} as const;

/** UI 동작 옵션 */
export const UI_RULES = {
  /** 행동 확정 후 참가자가 스스로 취소할 수 있는지 */
  allowCancelAfterSubmit: true,
  /** 라운드 처리 전 예상 결과를 보여줄지 */
  showRoundPreview: true,
  /** 로그에 계산 근거를 함께 표시할지 */
  showLogDetail: true,
} as const;

export const HUNTER_DEFAULTS = {
  maxHp: 100,
  attack: 12,
} as const;

export const DAMAGE_RULES = {
  /** 피해 계산 후 최소 보장 피해 */
  minimumDamage: 1,
  /** 기본 방어 시 받는 피해 감소 비율 */
  defenseReduction: 0.4,
} as const;

/** 부상 단계 기준. hp 비율(%) 하한선 기준으로 위에서부터 판정한다. */
export const INJURY_THRESHOLDS: Array<{
  stage: InjuryStage;
  minPercent: number;
  label: string;
  tone: 'ok' | 'warn' | 'danger' | 'critical' | 'offline';
}> = [
  { stage: 'NORMAL', minPercent: 70, label: '정상', tone: 'ok' },
  { stage: 'INJURED', minPercent: 40, label: '경상', tone: 'warn' },
  { stage: 'SEVERE', minPercent: 10, label: '중상', tone: 'danger' },
  { stage: 'CRITICAL', minPercent: 1, label: '위독', tone: 'critical' },
  { stage: 'DOWN', minPercent: 0, label: '전투 불능', tone: 'offline' },
];

/**
 * 성좌 상태 단계별 패널티.
 * Phase 1 에서는 maxApDelta 만 적용하고, 나머지 필드는 이후 단계에서 사용한다.
 */
export const CONSTELLATION_STAGES: Record<
  ConstellationStage,
  {
    label: string;
    labelKo: string;
    tone: 'ok' | 'warn' | 'danger' | 'critical' | 'offline';
    maxApDelta: number;
    buffPowerMultiplier: number;
    debuffPowerMultiplier: number;
    canManifest: boolean;
  }
> = {
  STABLE: {
    label: 'STABLE',
    labelKo: '안정',
    tone: 'ok',
    maxApDelta: 0,
    buffPowerMultiplier: 1,
    debuffPowerMultiplier: 1,
    canManifest: true,
  },
  UNSTABLE: {
    label: 'UNSTABLE',
    labelKo: '흔들림',
    tone: 'warn',
    maxApDelta: -1,
    buffPowerMultiplier: 0.9,
    debuffPowerMultiplier: 0.9,
    canManifest: true,
  },
  CRACKED: {
    label: 'CRACKED',
    labelKo: '균열',
    tone: 'danger',
    maxApDelta: -2,
    buffPowerMultiplier: 0.75,
    debuffPowerMultiplier: 0.75,
    canManifest: false,
  },
  COLLAPSE: {
    label: 'COLLAPSE',
    labelKo: '붕괴 직전',
    tone: 'critical',
    maxApDelta: -3,
    buffPowerMultiplier: 0.5,
    debuffPowerMultiplier: 0.5,
    canManifest: false,
  },
  LOST: {
    label: 'LOST',
    labelKo: '소멸',
    tone: 'offline',
    maxApDelta: -5,
    buffPowerMultiplier: 0,
    debuffPowerMultiplier: 0,
    canManifest: false,
  },
};

/** 계약 안정도 단계 표기. 게임 효과는 Phase 3 에서 적용한다. */
export const CONTRACT_STAGES: Record<
  ContractStage,
  { label: string; labelKo: string; tone: 'ok' | 'warn' | 'danger' | 'critical'; minValue: number }
> = {
  RESONANCE: { label: 'RESONANCE', labelKo: '공명', tone: 'ok', minValue: 85 },
  HEIGHTENED: { label: 'HEIGHTENED', labelKo: '고조', tone: 'ok', minValue: 70 },
  CALM: { label: 'CALM', labelKo: '평온', tone: 'ok', minValue: 50 },
  ANXIOUS: { label: 'ANXIOUS', labelKo: '불안', tone: 'warn', minValue: 30 },
  FRACTURED: { label: 'FRACTURED', labelKo: '균열', tone: 'danger', minValue: 10 },
  BROKEN: { label: 'BROKEN', labelKo: '붕괴', tone: 'critical', minValue: 0 },
};
