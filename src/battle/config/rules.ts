/**
 * 전투 규칙 수치.
 *
 * 밸런스 조정은 이 파일만 수정하면 되도록 유지한다.
 * 엔진과 UI 는 여기서 값을 읽어 쓰고, 숫자를 직접 적지 않는다.
 */

import type { ConstellationStage, ContractStage, InjuryStage } from '../types';

/** 현재 구현 단계. 이 값보다 큰 implementedIn 을 가진 행동은 선택할 수 없다. */
export const CURRENT_PHASE = 6;

/**
 * 저장 데이터 구조 버전.
 * 상태 구조가 바뀌면 올린다 — 이전 버전 데이터는 불러오지 않고 버린다.
 * 2: 캐릭터 시트 도입 (헌터 방어력 / 성좌 권능 배율 추가)
 * 3: 커스텀 스킬 · 상태이상 · 쿨타임 도입
 * 4: 연계 · 기믹 · 보스 패턴, 쪽별 제출(헌터/성좌 각각 다른 참가자)
 * 5: 기믹 파악/해결 판정, 시트 스탯 사본, 채팅
 * 6: 아이템 · 포인트 원장 · 계약 안정도 동작 · 전투 불능 저항
 */
export const SCHEMA_VERSION = 6;

export const AP_RULES = {
  hunterMaxAp: 5,
  constellationMaxAp: 5,
  /** 라운드 시작 시 회복량 */
  recoveryPerRound: 2,
} as const;

/** 현신 사용 제한 */
export const MANIFEST_RULES = {
  /** 전투당 부분 현신 사용 횟수 */
  partialPerBattle: 2,
  /** 공략 단위 완전 현신 사용 횟수 */
  fullPerCampaign: 1,
} as const;

/** 구조 규칙 */
export const RESCUE_RULES = {
  /** 구조 성공 시 회복되는 최대 HP 비율 */
  revivePercent: 0.3,
  /** 구조 후 부여되는 상태이상 */
  applyStatusIds: ['guard.up'] as string[],
} as const;

/** 회복 규칙 — 회복 스킬과 아이템이 함께 쓴다 */
export const HEAL_RULES = {
  /** 스킬 기본 수치 1.0 이 최대 HP 이 비율만큼 회복시킨다 */
  percentPerPower: 0.2,
  /** 회복이 성립하면 최소한 이만큼은 돌아온다 */
  minimumHeal: 1,
} as const;

/**
 * 전투 불능 저항 — 헌터의 의지(WIL).
 *
 * 판정을 굴리지 않는다. 굴림을 쓰면 예상 결과(preview)와 적용(apply)이 어긋나
 * 화면에 보여준 숫자와 실제 결과가 달라지기 때문이다.
 */
export const LAST_STAND_RULES = {
  /** 버텨냈을 때 남는 HP */
  survivingHp: 1,
  /** 전투당 허용 횟수 */
  usesPerBattle: 1,
} as const;

/**
 * 계약 안정도 규칙.
 *
 * 계약은 가만히 두면 조금씩 회복되고, 무리한 개입에는 값을 낸다.
 * 성좌의 공명(RES)이 회복을, 현신(MAN)이 반동 경감을 담당한다.
 */
export const CONTRACT_RULES = {
  /** 전투 시작 시 계약 안정도 */
  initialValue: 88,
  /** 라운드마다 들어오는 기본 회복 */
  recoveryPerRound: 1,
  /** 상한 · 하한 */
  minValue: 0,
  maxValue: 100,
  /** 이 값 미만으로 내려가면 성좌 상태가 한 단계 떨어진다 */
  stageDropBelow: 25,
  /** 사건별 변화량 */
  events: {
    /** 계약한 헌터가 쓰러졌다 */
    hunterDown: -12,
    /** 부분 현신 반동 */
    partialManifest: -8,
    /** 완전 현신 반동 */
    fullManifest: -20,
    /** 페어 연계 성립 */
    comboLinked: 2,
    /** 구조 성공 */
    rescueCompleted: 5,
    /** 기믹 해제 */
    gimmickCleared: 6,
  },
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

/**
 * 캐릭터 사진.
 *
 * 파일 저장소를 따로 두지 않고 시트 행 안에 data URL 로 넣는다.
 * 그래서 원본을 그대로 담지 않는다 — 브라우저에서 잘라 줄여 굽고,
 * 목표 용량 안으로 들어올 때까지 품질을 낮춘다.
 */
export const PORTRAIT_RULES = {
  /** 저장되는 정사각 한 변 (px) */
  side: 320,
  /** 사용자가 고를 수 있는 원본 크기 상한 */
  maxUploadBytes: 8 * 1024 * 1024,
  /** 저장되는 data URL 길이 상한 — 대략 90KB */
  maxStoredChars: 120_000,
  /** 위에서부터 시도하는 JPEG 품질 */
  qualitySteps: [0.82, 0.7, 0.6, 0.5, 0.4],
} as const;

/** 스탯 이전의 기본값. 최종 수치는 여기에 스탯·클래스 보정을 더해 만든다. */
export const HUNTER_DEFAULTS = {
  baseHp: 60,
  baseAttack: 4,
  baseDefense: 0,
} as const;

export const DAMAGE_RULES = {
  /** 피해 계산 후 최소 보장 피해 */
  minimumDamage: 1,
  /** 기본 방어 시 받는 피해 감소 비율 */
  defenseReduction: 0.4,
  /** 방어 행동과 상태이상을 합산한 피해 감소 상한 */
  maxDamageReduction: 0.85,
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

/** 성좌 상태 단계별 패널티. */
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

/**
 * 계약 안정도 단계.
 *
 * 표기뿐 아니라 실제 효과를 함께 둔다 — 권능 배율에 곱해지고, 붕괴하면 현신이 막힌다.
 * 단계는 값에서 파생되므로(engine/status.ts) minValue 순서를 흐트러뜨리지 않는다.
 */
export const CONTRACT_STAGES: Record<
  ContractStage,
  {
    label: string;
    labelKo: string;
    tone: 'ok' | 'warn' | 'danger' | 'critical';
    minValue: number;
    /** 성좌의 권능 효과 배율에 곱해진다 */
    powerMultiplier: number;
    /** 이 단계에서 현신을 쓸 수 있는지 */
    canManifest: boolean;
  }
> = {
  RESONANCE: {
    label: 'RESONANCE',
    labelKo: '공명',
    tone: 'ok',
    minValue: 85,
    powerMultiplier: 1.1,
    canManifest: true,
  },
  HEIGHTENED: {
    label: 'HEIGHTENED',
    labelKo: '고조',
    tone: 'ok',
    minValue: 70,
    powerMultiplier: 1.05,
    canManifest: true,
  },
  CALM: {
    label: 'CALM',
    labelKo: '평온',
    tone: 'ok',
    minValue: 50,
    powerMultiplier: 1,
    canManifest: true,
  },
  ANXIOUS: {
    label: 'ANXIOUS',
    labelKo: '불안',
    tone: 'warn',
    minValue: 30,
    powerMultiplier: 0.95,
    canManifest: true,
  },
  FRACTURED: {
    label: 'FRACTURED',
    labelKo: '균열',
    tone: 'danger',
    minValue: 10,
    powerMultiplier: 0.85,
    canManifest: true,
  },
  BROKEN: {
    label: 'BROKEN',
    labelKo: '붕괴',
    tone: 'critical',
    minValue: 0,
    powerMultiplier: 0.7,
    canManifest: false,
  },
};
