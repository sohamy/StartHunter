/**
 * 캐릭터 시트 정의 — 스탯, 클래스(권역), 파생 수치 공식.
 *
 * 스탯을 추가하려면 이 파일의 배열에 항목을 넣으면 된다.
 * UI 와 엔진은 목록을 순회할 뿐 개별 스탯 이름을 알지 않는다.
 */

import type { ActorSide, StatBlock } from '../types';

/** 스탯 배분 규칙 */
export const POINT_BUY = {
  /** 모든 스탯의 시작값 */
  baseValue: 1,
  /** 시작값 위로 자유롭게 배분할 수 있는 총량 */
  freePoints: 12,
  /** 스탯 하나의 상한 */
  maxValue: 6,
} as const;

export interface StatDefinition {
  key: string;
  label: string;
  labelKo: string;
  /** 이 스탯이 무엇에 영향을 주는지 — UI 에 그대로 노출한다 */
  effect: string;
  /** 실제로 계산에 반영되기 시작하는 구현 단계 */
  activeFrom: number;
}

export const HUNTER_STATS: StatDefinition[] = [
  {
    key: 'str',
    label: 'STR',
    labelKo: '근력',
    effect: '공격력 +1.2 / 1점',
    activeFrom: 1,
  },
  {
    key: 'vit',
    label: 'VIT',
    labelKo: '체력',
    effect: '최대 HP +8 / 1점',
    activeFrom: 1,
  },
  {
    key: 'agi',
    label: 'AGI',
    labelKo: '민첩',
    effect: '방어력 +0.8 / 1점 · 회피 판정',
    activeFrom: 1,
  },
  {
    key: 'sen',
    label: 'SEN',
    labelKo: '관찰력',
    effect: '기믹 파악 판정 +1 / 1점 · 약점 포착',
    activeFrom: 3,
  },
  {
    key: 'luk',
    label: 'LUK',
    labelKo: '운',
    effect: '기믹 해결 판정 +1 / 1점 · 대성공 확률',
    activeFrom: 3,
  },
  {
    key: 'wil',
    label: 'WIL',
    labelKo: '의지',
    effect: '상태이상 저항 · 전투 불능 저항 (PHASE 2)',
    activeFrom: 2,
  },
];

export const CONSTELLATION_STATS: StatDefinition[] = [
  {
    key: 'authority',
    label: 'AUT',
    labelKo: '권능',
    effect: '버프 · 디버프 효과 +4% / 1점',
    activeFrom: 1,
  },
  {
    key: 'divinity',
    label: 'DIV',
    labelKo: '신격',
    effect: '최대 행동력 +1 / 3점',
    activeFrom: 1,
  },
  {
    key: 'resonance',
    label: 'RES',
    labelKo: '공명',
    effect: '계약 안정도 회복 (PHASE 3)',
    activeFrom: 3,
  },
  {
    key: 'observation',
    label: 'OBS',
    labelKo: '관측',
    effect: '계시 정확도 · 헌터의 기믹 파악 지원 (2점당 +1)',
    activeFrom: 2,
  },
  {
    key: 'manifest',
    label: 'MAN',
    labelKo: '현신',
    effect: '현신 위력 · 반동 경감 (PHASE 3)',
    activeFrom: 3,
  },
];

export function statsFor(side: ActorSide): StatDefinition[] {
  return side === 'HUNTER' ? HUNTER_STATS : CONSTELLATION_STATS;
}

/** 스탯 → 파생 수치 환산 계수 */
export const STAT_SCALING = {
  hunter: {
    attackPerStr: 1.2,
    hpPerVit: 8,
    defensePerAgi: 0.8,
  },
  constellation: {
    powerPerAuthority: 0.04,
    /** 이 점수마다 최대 행동력 +1 */
    apPerDivinity: 3,
  },
} as const;

/** 클래스가 스탯 위에 얹는 보정 */
export interface ClassDefinition {
  id: string;
  side: ActorSide;
  label: string;
  labelKo: string;
  description: string;
  /** 이 클래스가 잘 쓰는 스탯 (UI 안내용) */
  focus: string[];
  bonus: {
    attack?: number;
    maxHp?: number;
    defense?: number;
    maxAp?: number;
    /** 권능 효과 배율에 더해지는 값 */
    power?: number;
  };
  /** 아직 반영되지 않은 특성 설명 */
  pending?: string;
}

export const HUNTER_CLASSES: ClassDefinition[] = [
  {
    id: 'striker',
    side: 'HUNTER',
    label: 'STRIKER',
    labelKo: '근접 격퇴형',
    description: '탑 안에서 가장 앞에 서서 적을 직접 베어내는 유형.',
    focus: ['str', 'agi'],
    bonus: { attack: 3, maxHp: 5 },
  },
  {
    id: 'guardian',
    side: 'HUNTER',
    label: 'GUARDIAN',
    labelKo: '방어 전담형',
    description: '피해를 자기 쪽으로 끌어와 페어와 다른 공략조를 지킨다.',
    focus: ['vit', 'agi'],
    bonus: { attack: -1, maxHp: 25, defense: 3 },
    pending: '보호 행동 보정 — PHASE 3',
  },
  {
    id: 'ranger',
    side: 'HUNTER',
    label: 'RANGER',
    labelKo: '원거리 사격형',
    description: '거리를 유지하며 약점을 노린다. 맞으면 크게 아프다.',
    focus: ['sen', 'agi'],
    bonus: { attack: 2, maxHp: -5, defense: -1 },
    pending: '약점 공격 판정 — PHASE 3',
  },
  {
    id: 'caster',
    side: 'HUNTER',
    label: 'CASTER',
    labelKo: '권능 술사형',
    description: '성좌의 권능을 몸으로 받아 그대로 쏟아낸다. 행동력이 넉넉하다.',
    focus: ['wil', 'str'],
    bonus: { attack: 1, maxAp: 1 },
    pending: '권능 증폭 — PHASE 2',
  },
  {
    id: 'medic',
    side: 'HUNTER',
    label: 'MEDIC',
    labelKo: '구조 지원형',
    description: '쓰러진 헌터를 끌어내고 응급 처치를 담당한다.',
    focus: ['wil', 'vit'],
    bonus: { maxHp: 12, defense: 1 },
    pending: '구조 · 치료 보정 — PHASE 3',
  },
];

export const CONSTELLATION_CLASSES: ClassDefinition[] = [
  {
    id: 'war',
    side: 'CONSTELLATION',
    label: 'WAR',
    labelKo: '전투 권역',
    description: '전쟁과 무기의 이름을 가진 성좌. 헌터의 공격을 직접 끌어올린다.',
    focus: ['authority', 'manifest'],
    bonus: { power: 0.1 },
  },
  {
    id: 'guard',
    side: 'CONSTELLATION',
    label: 'GUARD',
    labelKo: '수호 권역',
    description: '성벽과 맹세의 이름을 가진 성좌. 헌터를 지키는 데 특화되어 있다.',
    focus: ['resonance', 'authority'],
    bonus: { power: 0.05, maxAp: 1 },
    pending: '피해 감소 강화 — PHASE 2',
  },
  {
    id: 'omen',
    side: 'CONSTELLATION',
    label: 'OMEN',
    labelKo: '예지 권역',
    description: '앞을 내다보는 성좌. 계시가 정확하고 멀리 닿는다.',
    focus: ['observation', 'divinity'],
    bonus: { maxAp: 1 },
    pending: '계시 범위 확장 — PHASE 2',
  },
  {
    id: 'calamity',
    side: 'CONSTELLATION',
    label: 'CALAMITY',
    labelKo: '재앙 권역',
    description: '역병과 기근의 이름을 가진 성좌. 적을 무너뜨리는 데 능하다.',
    focus: ['authority', 'observation'],
    bonus: { power: 0.15 },
    pending: '상태이상 부여 강화 — PHASE 2',
  },
  {
    id: 'grace',
    side: 'CONSTELLATION',
    label: 'GRACE',
    labelKo: '은총 권역',
    description: '치유와 자비의 이름을 가진 성좌. 헌터를 살려 돌려보낸다.',
    focus: ['resonance', 'divinity'],
    bonus: { maxAp: 1 },
    pending: '치유 · 구조 보정 — PHASE 3',
  },
];

export function classesFor(side: ActorSide): ClassDefinition[] {
  return side === 'HUNTER' ? HUNTER_CLASSES : CONSTELLATION_CLASSES;
}

export function findClass(side: ActorSide, classId: string | null): ClassDefinition | null {
  if (!classId) return null;
  return classesFor(side).find((row) => row.id === classId) ?? null;
}

/** 시트 작성 시작값 */
export function initialStats(side: ActorSide): StatBlock {
  const stats: StatBlock = {};
  for (const stat of statsFor(side)) {
    stats[stat.key] = POINT_BUY.baseValue;
  }
  return stats;
}

export function spentPoints(side: ActorSide, stats: StatBlock): number {
  return statsFor(side).reduce(
    (sum, stat) => sum + ((stats[stat.key] ?? POINT_BUY.baseValue) - POINT_BUY.baseValue),
    0,
  );
}

export function remainingPoints(side: ActorSide, stats: StatBlock): number {
  return POINT_BUY.freePoints - spentPoints(side, stats);
}
