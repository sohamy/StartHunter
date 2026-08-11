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
];

export const PATTERN_SETS: PatternSet[] = [
  {
    id: 'set.star_devourer',
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
    phaseThresholds: [{ phase: 1, minPercent: 0, label: 'PHASE 1' }],
    triggers: [],
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
