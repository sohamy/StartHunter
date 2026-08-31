/**
 * 캐릭터 시트 정의 — 스탯, 클래스(권역), 파생 수치 공식.
 *
 * 스탯을 추가하려면 이 파일의 배열에 항목을 넣으면 된다.
 * UI 와 엔진은 목록을 순회할 뿐 개별 스탯 이름을 알지 않는다.
 */

import type { ActorSide, ProfileFieldKey, SheetProfile, StatBlock } from '../types';

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
  /**
   * 실제로 계산에 반영되기 시작하는 구현 단계.
   * `CURRENT_PHASE` 이하면 이미 동작하는 것이므로 화면에 아무 표시도 하지 않는다.
   * 그보다 크면 "미반영"으로 표시한다 — 완료된 단계 번호를 띄우면 거짓말이 된다.
   */
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
    effect: '기믹 파악 판정 +1 / 1점 · 성좌 관측이 절반 더해짐',
    activeFrom: 1,
  },
  {
    key: 'luk',
    label: 'LUK',
    labelKo: '운',
    effect: '기믹 해결 판정 +1 / 1점 · 대성공 확률',
    activeFrom: 1,
  },
  {
    key: 'wil',
    label: 'WIL',
    labelKo: '의지',
    effect: '디버프 지속 −1R / 3점 · 전투 불능 저항 (전투당 1회)',
    activeFrom: 1,
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
    effect: '라운드마다 계약 안정도 +1.5 / 1점',
    activeFrom: 1,
  },
  {
    key: 'observation',
    label: 'OBS',
    labelKo: '관측',
    effect: '헌터의 기믹 파악 지원 (2점당 +1) · 계시 정확도',
    activeFrom: 1,
  },
  {
    key: 'manifest',
    label: 'MAN',
    labelKo: '현신',
    effect: '현신 위력 +8% / 1점 · 현신 반동 경감',
    activeFrom: 1,
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
    /** 이 점수마다 받는 디버프 지속시간 −1 라운드 */
    resistPerWil: 3,
    /** 전투 불능 저항이 발동하는 의지 최소치 */
    lastStandMinWil: 4,
  },
  constellation: {
    powerPerAuthority: 0.04,
    /** 이 점수마다 최대 행동력 +1 */
    apPerDivinity: 3,
    /** 공명 1점당 라운드마다 회복되는 계약 안정도 */
    contractRecoveryPerResonance: 1.5,
    /** 현신 1점당 현신 위력 증가 비율 */
    manifestPowerPerPoint: 0.08,
    /** 현신 1점당 반동(계약 안정도 손실) 경감 비율 */
    recoilReliefPerPoint: 0.08,
  },
} as const;

/**
 * 클래스 · 권역 고유 특성.
 *
 * `bonus` 는 시트 파생 단계에서 한 번 더해지는 정적 수치이고,
 * 여기 있는 값은 **라운드 처리 중에** 상황에 따라 개입한다.
 * 엔진(engine/traits.ts)은 이 필드를 읽을 뿐 클래스 id 를 알지 않는다 —
 * 새 클래스를 추가할 때 엔진을 고치지 않기 위한 것이다.
 */
export interface ClassTraits {
  /** 보호 행동으로 부여하는 피해 감소 상태이상의 효과 배율 추가분 */
  protectBonus?: number;
  /** 약점이 드러난 적에게 주는 피해 추가 비율 */
  weakPointBonus?: number;
  /** 성좌에게 받는 공격력 증가 버프에 곱하는 배율 추가분 */
  buffAmplify?: number;
  /** 구조 회복량 추가 비율 */
  rescueBonus?: number;
  /** 회복(스킬 · 아이템) 효과 추가 비율 */
  healBonus?: number;
  /** 자기 쪽이 부여하는 피해 감소 상태이상의 효과 배율 추가분 */
  guardAmplify?: number;
  /** 계시가 공략조 전체에 공유된다 */
  revelationShared?: boolean;
  /** 자기 쪽이 적에게 거는 상태이상의 지속 라운드 추가 */
  statusDurationBonus?: number;
}

/** 특성을 사람이 읽는 문장으로 — 시트와 전투 화면이 함께 쓴다 */
export function describeTraits(traits: ClassTraits | undefined): string[] {
  if (!traits) return [];
  const lines: string[] = [];
  if (traits.protectBonus) lines.push(`보호 효과 +${Math.round(traits.protectBonus * 100)}%`);
  if (traits.weakPointBonus) {
    lines.push(`약점 공격 피해 +${Math.round(traits.weakPointBonus * 100)}%`);
  }
  if (traits.buffAmplify) lines.push(`받는 버프 +${Math.round(traits.buffAmplify * 100)}%`);
  if (traits.rescueBonus) lines.push(`구조 회복 +${Math.round(traits.rescueBonus * 100)}%`);
  if (traits.healBonus) lines.push(`회복량 +${Math.round(traits.healBonus * 100)}%`);
  if (traits.guardAmplify) lines.push(`피해 감소 부여 +${Math.round(traits.guardAmplify * 100)}%`);
  if (traits.revelationShared) lines.push('계시가 공략조 전체에 공유됨');
  if (traits.statusDurationBonus) lines.push(`부여 상태이상 +${traits.statusDurationBonus}R`);
  return lines;
}

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
  /** 라운드 처리 중에 개입하는 고유 특성 */
  traits?: ClassTraits;
  /**
   * 아직 반영되지 않은 특성 설명. 숫자 보정(bonus)과 traits 는 이미 적용된다.
   * 앞으로 붙일 특성을 숨기지 않기 위한 자리이며, 지금은 비어 있다.
   */
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
    traits: { protectBonus: 0.4, guardAmplify: 0.2 },
  },
  {
    id: 'ranger',
    side: 'HUNTER',
    label: 'RANGER',
    labelKo: '원거리 사격형',
    description: '거리를 유지하며 약점을 노린다. 맞으면 크게 아프다.',
    focus: ['sen', 'agi'],
    bonus: { attack: 2, maxHp: -5, defense: -1 },
    traits: { weakPointBonus: 0.25 },
  },
  {
    id: 'caster',
    side: 'HUNTER',
    label: 'CASTER',
    labelKo: '권능 술사형',
    description: '성좌의 권능을 몸으로 받아 그대로 쏟아낸다. 행동력이 넉넉하다.',
    focus: ['wil', 'str'],
    bonus: { attack: 1, maxAp: 1 },
    traits: { buffAmplify: 0.25 },
  },
  {
    id: 'medic',
    side: 'HUNTER',
    label: 'MEDIC',
    labelKo: '구조 지원형',
    description: '쓰러진 헌터를 끌어내고 응급 처치를 담당한다.',
    focus: ['wil', 'vit'],
    bonus: { maxHp: 12, defense: 1 },
    traits: { rescueBonus: 0.5, healBonus: 0.3 },
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
    traits: { guardAmplify: 0.5, protectBonus: 0.2 },
  },
  {
    id: 'omen',
    side: 'CONSTELLATION',
    label: 'OMEN',
    labelKo: '예지 권역',
    description: '앞을 내다보는 성좌. 계시가 정확하고 멀리 닿는다.',
    focus: ['observation', 'divinity'],
    bonus: { maxAp: 1 },
    traits: { revelationShared: true },
  },
  {
    id: 'calamity',
    side: 'CONSTELLATION',
    label: 'CALAMITY',
    labelKo: '재앙 권역',
    description: '역병과 기근의 이름을 가진 성좌. 적을 무너뜨리는 데 능하다.',
    focus: ['authority', 'observation'],
    bonus: { power: 0.15 },
    traits: { statusDurationBonus: 1 },
  },
  {
    id: 'grace',
    side: 'CONSTELLATION',
    label: 'GRACE',
    labelKo: '은총 권역',
    description: '치유와 자비의 이름을 가진 성좌. 헌터를 살려 돌려보낸다.',
    focus: ['resonance', 'divinity'],
    bonus: { maxAp: 1 },
    traits: { healBonus: 0.4, rescueBonus: 0.3 },
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

/* ── 컨셉 서술 ──────────────────────────────────────────
   등록 · 시트 편집 · 열람 화면은 모두 이 목록을 순회해서 그린다.
   칸을 늘리거나 안내 문구를 고칠 때 여기만 손대면 된다. */

export interface ProfileFieldDef {
  key: ProfileFieldKey;
  label: string;
  labelKo: string;
  /** 입력 칸 아래 안내 */
  hint: string;
  placeholder: string;
  rows: number;
  /** 글자 수 상한 */
  maxChars: number;
}

export const PROFILE_FIELDS: ProfileFieldDef[] = [
  {
    key: 'personality',
    label: 'PERSONALITY',
    labelKo: '성격',
    hint: '평소 태도, 말투, 위기에서 나오는 반응 등',
    placeholder: '예) 말수가 적고 결정을 미루지 않는다. 궁지에 몰릴수록 목소리가 낮아진다.',
    rows: 6,
    maxChars: 1000,
  },
  {
    key: 'traits',
    label: 'TRAITS',
    labelKo: '특징',
    hint: '좋아하는 것 · 싫어하는 것 · 생일 · 버릇 · 외형 등',
    placeholder: '예) 생일 3/14 · 좋아하는 것: 단 것, 비 오는 날 · 싫어하는 것: 빈말, 엘리베이터',
    rows: 6,
    maxChars: 1000,
  },
  {
    key: 'contractStory',
    label: 'CONTRACT',
    labelKo: '계약 경위',
    hint: '성좌와 계약을 맺은 경위 — 아직 정하지 않았다면 비워 두어도 된다.',
    placeholder: '예) 3층 붕괴 현장에서 마지막까지 남았을 때, 이름 없는 목소리가 먼저 손을 내밀었다.',
    rows: 6,
    maxChars: 1000,
  },
];

/** 비어 있는 컨셉 서술 */
export function emptyProfile(): SheetProfile {
  return { personality: '', traits: '', contractStory: '' };
}

/**
 * 예전 시트(한 칸짜리 `concept`)와 새 시트를 같은 모양으로 맞춘다.
 * 저장된 값이 없을 수 있는 자리를 화면과 검증이 그대로 믿을 수 있게 한다.
 */
export function toProfile(source: Partial<SheetProfile> & { concept?: string }): SheetProfile {
  return {
    personality: source.personality ?? source.concept ?? '',
    traits: source.traits ?? '',
    contractStory: source.contractStory ?? '',
  };
}

/** 서술이 하나라도 채워져 있는지 — 열람 화면에서 섹션을 숨길지 결정한다. */
export function hasProfile(source: Partial<SheetProfile> | null | undefined): boolean {
  if (!source) return false;
  return PROFILE_FIELDS.some((field) => (source[field.key] ?? '').trim().length > 0);
}

/* ── 공개 범위 ──────────────────────────────────────────
   같은 시트를 누가 어디까지 보는지 한 곳에 적어 둔다.
   화면 안내 문구가 이 목록을 그대로 읽으므로, 경계를 바꾸면 안내도 함께 바뀐다.

   원칙: **제출한 시트 내용은 전부 공개한다.**
   참가자끼리 서로의 캐릭터를 읽는 것이 이 커뮤니티의 목적이므로 가리지 않는다.
   관리국만 보는 것은 시트가 아니라 운영 정보(계정 · 포인트 · 전투 기록)다. */

export const SHEET_DISCLOSURE = {
  /** 다른 참가자에게 보이는 것 — 제출한 시트 전부 */
  public: [
    '캐릭터 사진과 이름(성호)',
    '헌터 / 성좌 구분과 클래스 · 권역',
    '소속 진영 (정부 · 민간 길드)',
    '성격 · 특징 · 계약 경위',
    '스킬 — 이름 · 종류 · 설명 · AP · 위력 · 쿨 · 부여 상태',
    '스탯 배분값과 환산 전투 수치 (HP · 공격 · 방어 · AP · 권능)',
    '편성된 페어와 상대 이름',
    '페어 공용 포인트와 보급품',
  ],
  /** 운영진(관리국)만 보는 것 — 시트가 아니라 운영 정보 */
  operatorOnly: [
    '계정 정보 (로그인 · 비밀번호)',
    '포인트 지급 · 차감과 보급품 구매 · 반납 권한',
    '전투 기록 전문과 정산 내역',
    '전투 중 조정한 수치 (시트가 아니라 전투 상태 쪽 값)',
  ],
} as const;
