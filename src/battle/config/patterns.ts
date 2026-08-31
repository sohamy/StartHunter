/**
 * 보스 패턴과 페이즈 정의.
 *
 * 패턴은 라운드 · 페이즈 조건으로 선택되며, 예고(telegraph)를 거쳐 발동할 수 있다.
 * 참가자에게 미리 공개할지 여부도 데이터로 정한다.
 */

export type PatternShape = 'SINGLE' | 'AOE' | 'TELEGRAPH' | 'BUFF' | 'GIMMICK';

export interface PatternDefinition {
  id: string;
  label: string;
  labelKo: string;
  description: string;
  shape: PatternShape;
  /** 공격력에 곱하는 계수 */
  powerRatio: number;
  /** 부여하는 상태이상 */
  applyStatusIds: string[];
  /** 자신에게 부여하는 상태이상 (분노 등) */
  selfStatusIds: string[];
  /** 참가자에게 사전 공개되는지 */
  revealed: boolean;
  /** 예고 문구 — TELEGRAPH 패턴에서 사용 */
  telegraphMessage?: string;
  /** 예고 후 발동까지의 라운드 */
  telegraphRounds?: number;
  /** 예고가 끝났을 때 실제로 발동하는 패턴 */
  resolvesTo?: string;
}

export interface PatternTrigger {
  patternId: string;
  /** 이 페이즈에서만 등장. 생략하면 모든 페이즈 */
  phase?: number;
  /** 라운드 주기 — round % every === offset */
  every?: number;
  offset?: number;
  /** HP 비율이 이 값 이하일 때만 */
  hpBelowPercent?: number;
  priority: number;
}

export interface PatternSet {
  id: string;
  label: string;
  labelKo: string;
  /** 이 세트를 언제 쓰는지 — 적 세팅 화면에서 그대로 보여 준다 */
  note: string;
  /**
   * 층 기믹이 함께 있어야 성립하는 세트인지.
   * false 면 기믹 없이도 완결된 보스가 된다.
   */
  requiresGimmick: boolean;
  /** HP 비율 상한 기준 페이즈 경계. 내림차순으로 둔다 */
  phaseThresholds: Array<{ phase: number; minPercent: number; label: string }>;
  triggers: PatternTrigger[];
  /** 어느 트리거에도 걸리지 않을 때 쓰는 기본 패턴 */
  fallbackPatternId: string;
}

export const PATTERN_DEFINITIONS: PatternDefinition[] = [
  {
    id: 'pattern.single',
    label: 'SINGLE STRIKE',
    labelKo: '단일 공격',
    description: '가장 가까운 헌터 하나를 노린다.',
    shape: 'SINGLE',
    powerRatio: 1,
    applyStatusIds: [],
    selfStatusIds: [],
    revealed: true,
  },
  {
    id: 'pattern.rend',
    label: 'REND',
    labelKo: '찢기',
    description: '헌터 하나를 깊게 베어 출혈을 남긴다.',
    shape: 'SINGLE',
    powerRatio: 1.2,
    applyStatusIds: ['bleed'],
    selfStatusIds: [],
    revealed: true,
  },
  {
    id: 'pattern.sweep.warning',
    label: 'SWEEP WARNING',
    labelKo: '광역 공격 예고',
    description: '짐승이 몸을 웅크리며 힘을 모은다.',
    shape: 'TELEGRAPH',
    powerRatio: 0,
    applyStatusIds: [],
    selfStatusIds: [],
    revealed: true,
    telegraphMessage: 'MASSIVE ENERGY DETECTED — 다음 라운드 광역 공격',
    telegraphRounds: 1,
    resolvesTo: 'pattern.sweep',
  },
  {
    id: 'pattern.sweep',
    label: 'STAR SWEEP',
    labelKo: '광역 공격',
    description: '별빛을 흩뿌려 공략조 전체를 훑는다.',
    shape: 'AOE',
    powerRatio: 0.9,
    applyStatusIds: ['burn'],
    selfStatusIds: [],
    revealed: true,
  },
  {
    id: 'pattern.enrage',
    label: 'ENRAGE',
    labelKo: '분노',
    description: '짐승이 포효하며 공격력을 끌어올린다.',
    shape: 'BUFF',
    powerRatio: 0,
    applyStatusIds: [],
    selfStatusIds: ['enraged'],
    revealed: false,
  },
  {
    id: 'pattern.devour.warning',
    label: 'DEVOUR WARNING',
    labelKo: '포식 예고',
    description: '탑 전체가 울리며 무언가를 삼킬 준비를 한다.',
    shape: 'TELEGRAPH',
    powerRatio: 0,
    applyStatusIds: [],
    selfStatusIds: [],
    revealed: true,
    telegraphMessage: 'TOWER ALERT — 2 라운드 후 포식. 기믹을 해제해야 한다',
    telegraphRounds: 2,
    resolvesTo: 'pattern.devour',
  },
  {
    id: 'pattern.devour',
    label: 'CONSTELLATION EATER',
    labelKo: '포식',
    description: '성좌의 이름을 부르며 공략조를 집어삼킨다. 기믹을 해제하지 못하면 치명적이다.',
    shape: 'AOE',
    powerRatio: 2.2,
    applyStatusIds: ['weak'],
    selfStatusIds: [],
    revealed: true,
  },

  /* ── 기믹 없이 성립하는 보스용 ──────────────────────
     장치를 풀어서가 아니라, 예고를 읽고 방어 · 보호 · 구조를 맞춰서 넘긴다. */
  {
    id: 'pattern.pierce',
    label: 'PIERCE',
    labelKo: '관통',
    description: '방패를 무시하고 한 사람의 급소를 뚫는다.',
    shape: 'SINGLE',
    powerRatio: 1.5,
    applyStatusIds: ['def.down'],
    selfStatusIds: [],
    revealed: true,
  },
  {
    id: 'pattern.brand',
    label: 'BRAND',
    labelKo: '낙인',
    description: '한 사람에게 표식을 새겨 회복을 막는다.',
    shape: 'SINGLE',
    powerRatio: 0.8,
    applyStatusIds: ['heal.block', 'bleed'],
    selfStatusIds: [],
    revealed: true,
  },
  {
    id: 'pattern.fortify',
    label: 'FORTIFY',
    labelKo: '경계 태세',
    description: '자세를 낮추고 다음 일격을 준비한다.',
    shape: 'BUFF',
    powerRatio: 0,
    applyStatusIds: [],
    selfStatusIds: ['guard.up'],
    revealed: true,
  },
  {
    id: 'pattern.judgement.warning',
    label: 'JUDGEMENT WARNING',
    labelKo: '심판 예고',
    description: '감시자가 한 사람을 지목하고 칼끝을 겨눈다.',
    shape: 'TELEGRAPH',
    powerRatio: 0,
    applyStatusIds: [],
    selfStatusIds: [],
    revealed: true,
    telegraphMessage: 'TARGET LOCKED — 2 라운드 후 심판. 방어 · 보호 · 구조로 받아 내야 한다',
    telegraphRounds: 2,
    resolvesTo: 'pattern.judgement',
  },
  {
    id: 'pattern.judgement',
    label: 'JUDGEMENT',
    labelKo: '심판',
    description: '지목한 한 사람에게 모든 힘을 실어 내리친다. 받아 낼 준비가 없으면 그대로 쓰러진다.',
    shape: 'SINGLE',
    powerRatio: 2.6,
    applyStatusIds: ['weak'],
    selfStatusIds: [],
    revealed: true,
  },
];

export const PATTERN_SETS: PatternSet[] = [
  {
    id: 'set.star_devourer',
    label: 'STAR DEVOURER',
    labelKo: '별을 먹는 짐승 (기믹 필요)',
    note: '3페이즈에서 포식을 예고한다. 층 기믹을 해제하지 못하면 공략조가 버티기 어렵다.',
    requiresGimmick: true,
    phaseThresholds: [
      { phase: 1, minPercent: 71, label: 'PHASE 1' },
      { phase: 2, minPercent: 31, label: 'PHASE 2' },
      { phase: 3, minPercent: 0, label: 'PHASE 3' },
    ],
    triggers: [
      // 3페이즈 — 포식 예고 후 발동
      { patternId: 'pattern.devour.warning', phase: 3, every: 4, offset: 1, priority: 1 },
      { patternId: 'pattern.enrage', phase: 3, every: 4, offset: 0, priority: 2 },
      // 2페이즈 — 광역 예고 → 광역
      { patternId: 'pattern.sweep.warning', phase: 2, every: 3, offset: 1, priority: 3 },
      { patternId: 'pattern.rend', phase: 2, every: 3, offset: 2, priority: 4 },
      // 1페이즈
      { patternId: 'pattern.rend', phase: 1, every: 3, offset: 0, priority: 5 },
    ],
    fallbackPatternId: 'pattern.single',
  },
  {
    id: 'set.husk',
    label: 'HUSK',
    labelKo: '잡몹 (단일 공격만)',
    note: '페이즈도 예고도 없다. 층을 채우는 일반 몬스터에 쓴다.',
    requiresGimmick: false,
    phaseThresholds: [{ phase: 1, minPercent: 0, label: 'PHASE 1' }],
    triggers: [],
    fallbackPatternId: 'pattern.single',
  },

  /**
   * 기믹 없는 보스.
   *
   * 장치를 푸는 대신 예고를 읽고 방어 · 보호 · 구조를 맞추는 것으로 넘긴다.
   * 층에 기믹을 걸지 않고도 3페이즈 보스전이 성립한다.
   */
  {
    id: 'set.warden',
    label: 'TOWER WARDEN',
    labelKo: '탑의 감시자 (기믹 없음)',
    note: '심판 예고를 2라운드 전에 알린다. 방어 · 보호 · 구조 타이밍만으로 공략한다.',
    requiresGimmick: false,
    phaseThresholds: [
      { phase: 1, minPercent: 71, label: 'PHASE 1' },
      { phase: 2, minPercent: 31, label: 'PHASE 2' },
      { phase: 3, minPercent: 0, label: 'PHASE 3' },
    ],
    triggers: [
      // 3페이즈 — 심판 예고 → 심판. 사이에 경계 태세로 한 박자 쉰다
      { patternId: 'pattern.judgement.warning', phase: 3, every: 3, offset: 0, priority: 1 },
      { patternId: 'pattern.pierce', phase: 3, every: 3, offset: 2, priority: 2 },
      // 2페이즈 — 낙인으로 회복을 끊고 관통으로 밀어붙인다
      { patternId: 'pattern.brand', phase: 2, every: 3, offset: 1, priority: 3 },
      { patternId: 'pattern.pierce', phase: 2, every: 3, offset: 2, priority: 4 },
      { patternId: 'pattern.fortify', phase: 2, every: 3, offset: 0, priority: 5 },
      // 1페이즈 — 광역 예고 → 광역
      { patternId: 'pattern.sweep.warning', phase: 1, every: 4, offset: 1, priority: 6 },
      { patternId: 'pattern.rend', phase: 1, every: 4, offset: 3, priority: 7 },
    ],
    fallbackPatternId: 'pattern.single',
  },
];

export function findPattern(patternId: string | null): PatternDefinition | null {
  if (!patternId) return null;
  return PATTERN_DEFINITIONS.find((row) => row.id === patternId) ?? null;
}

export function findPatternSet(setId: string | null): PatternSet | null {
  if (!setId) return null;
  return PATTERN_SETS.find((row) => row.id === setId) ?? null;
}
