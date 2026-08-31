/**
 * 커스텀 스킬 규칙.
 *
 * 참가자가 시트에 등록하는 스킬의 허용 범위를 정의한다.
 * 정해진 스킬 목록을 강제하지 않되, 수치 범위는 여기서 제한한다.
 * 운영진은 시트 편집에서 이 범위를 넘겨 수정할 수 있다.
 */

import type { ActorSide, SkillDefinition, SkillKind, TargetType } from '../types';

export const SKILL_RULES = {
  /** 시트에 등록할 수 있는 스킬 수 */
  maxSkills: 3,
  minSkills: 0,
  apCost: { min: 0, max: 4 },
  /** 공격 계수 또는 효과 배율 */
  power: { min: 0, max: 3, step: 0.1 },
  cooldown: { min: 0, max: 4 },
  /** 전투당 사용 횟수. 0 은 무제한으로 취급한다 */
  maxUses: { min: 0, max: 5 },
  /** 스킬 하나가 부여할 수 있는 상태이상 수 */
  maxStatuses: 2,
  nameMaxLength: 24,
  descriptionMaxLength: 160,
  specialMaxLength: 160,
} as const;

export interface SkillKindDefinition {
  kind: SkillKind;
  label: string;
  labelKo: string;
  /** 이 종류에서 기본으로 쓰는 대상 */
  defaultTarget: TargetType;
  sides: ActorSide[];
  /** power 값이 무엇으로 해석되는지 */
  powerMeaning: string;
  /** 계산에 반영되는 구현 단계. CURRENT_PHASE 보다 크면 화면에 '미반영'으로 표시한다. */
  activeFrom: number;
}

export const SKILL_KINDS: SkillKindDefinition[] = [
  {
    kind: 'ATTACK',
    label: 'ATTACK',
    labelKo: '공격',
    defaultTarget: 'ENEMY',
    sides: ['HUNTER', 'CONSTELLATION'],
    powerMeaning: '공격력에 곱하는 계수',
    activeFrom: 1,
  },
  {
    kind: 'DEFENSE',
    label: 'DEFENSE',
    labelKo: '방어',
    defaultTarget: 'SELF',
    sides: ['HUNTER'],
    powerMeaning: '받는 피해 감소 비율 (0.4 = 40%)',
    activeFrom: 1,
  },
  {
    kind: 'BUFF',
    label: 'BUFF',
    labelKo: '버프',
    defaultTarget: 'PAIR',
    sides: ['CONSTELLATION'],
    powerMeaning: '헌터 공격력 증가 비율',
    activeFrom: 1,
  },
  {
    kind: 'DEBUFF',
    label: 'DEBUFF',
    labelKo: '디버프',
    defaultTarget: 'ENEMY',
    sides: ['CONSTELLATION'],
    powerMeaning: '적 방어력 감소 비율',
    activeFrom: 1,
  },
  {
    kind: 'UTILITY',
    label: 'UTILITY',
    labelKo: '보조',
    defaultTarget: 'NONE',
    sides: ['HUNTER', 'CONSTELLATION'],
    powerMeaning: '상태이상 부여 전용 — 수치 없음',
    activeFrom: 1,
  },
  {
    kind: 'HEAL',
    label: 'HEAL',
    labelKo: '회복',
    defaultTarget: 'PAIR',
    sides: ['HUNTER', 'CONSTELLATION'],
    powerMeaning: '최대 HP 대비 회복 비율 (1.0 = 20%)',
    activeFrom: 1,
  },
  {
    kind: 'MANIFESTATION',
    label: 'MANIFEST',
    labelKo: '현신',
    defaultTarget: 'ENEMY',
    sides: ['CONSTELLATION'],
    powerMeaning: '현신 공격 계수',
    activeFrom: 1,
  },
];

export function skillKindsFor(side: ActorSide): SkillKindDefinition[] {
  return SKILL_KINDS.filter((row) => row.sides.includes(side));
}

export function findSkillKind(kind: SkillKind): SkillKindDefinition | null {
  return SKILL_KINDS.find((row) => row.kind === kind) ?? null;
}

/** 새 스킬을 만들 때의 초기값 */
export function blankSkill(side: ActorSide, index: number): SkillDefinition {
  const kind: SkillKind = side === 'HUNTER' ? 'ATTACK' : 'BUFF';
  return {
    id: `SK-${side === 'HUNTER' ? 'H' : 'C'}-${index + 1}`,
    side,
    kind,
    name: '',
    description: '',
    apCost: 2,
    target: findSkillKind(kind)?.defaultTarget ?? 'ENEMY',
    power: side === 'HUNTER' ? 1.6 : 0.3,
    cooldown: 1,
    maxUses: null,
    applyStatusIds: [],
    special: '',
  };
}

/** 프리셋 NPC 스킬 — 참가자 스킬과 같은 구조를 쓴다 */
export const PRESET_HUNTER_SKILLS: SkillDefinition[][] = [
  [
    {
      id: 'SK-NPC-H1',
      side: 'HUNTER',
      kind: 'ATTACK',
      name: 'STAR SLASH',
      description: '별빛을 실어 내리치는 일격.',
      apCost: 2,
      target: 'ENEMY',
      power: 1.6,
      cooldown: 1,
      maxUses: null,
      applyStatusIds: ['bleed'],
      special: '',
    },
    {
      id: 'SK-NPC-H2',
      side: 'HUNTER',
      kind: 'ATTACK',
      name: 'BREAK EDGE',
      description: '갑각을 부수는 데 특화된 강타.',
      apCost: 3,
      target: 'ENEMY',
      power: 2.4,
      cooldown: 2,
      maxUses: 3,
      applyStatusIds: ['weak'],
      special: '',
    },
  ],
  [
    {
      id: 'SK-NPC-H3',
      side: 'HUNTER',
      kind: 'DEFENSE',
      name: 'IRON WALL',
      description: '방패를 세워 전선을 버틴다.',
      apCost: 2,
      target: 'SELF',
      power: 0.5,
      cooldown: 2,
      maxUses: null,
      applyStatusIds: ['guard.up'],
      special: '',
    },
  ],
  [
    {
      id: 'SK-NPC-H4',
      side: 'HUNTER',
      kind: 'ATTACK',
      name: 'PIERCE SHOT',
      description: '약점을 관통하는 사격.',
      apCost: 2,
      target: 'ENEMY',
      power: 1.8,
      cooldown: 1,
      maxUses: null,
      applyStatusIds: [],
      special: '',
    },
  ],
  [
    {
      id: 'SK-NPC-H5',
      side: 'HUNTER',
      kind: 'ATTACK',
      name: 'BURNING OATH',
      description: '권능을 태워 쏟아내는 공격.',
      apCost: 3,
      target: 'ENEMY',
      power: 2,
      cooldown: 2,
      maxUses: 2,
      applyStatusIds: ['burn'],
      special: '',
    },
  ],
];

export const PRESET_CONSTELLATION_SKILLS: SkillDefinition[][] = [
  [
    {
      id: 'SK-NPC-C1',
      side: 'CONSTELLATION',
      kind: 'BUFF',
      name: "WINTER'S BLESSING",
      description: '겨울의 이름으로 헌터를 벼린다.',
      apCost: 2,
      target: 'PAIR',
      power: 0.5,
      cooldown: 2,
      maxUses: null,
      applyStatusIds: ['atk.up.great'],
      special: '',
    },
  ],
  [
    {
      id: 'SK-NPC-C2',
      side: 'CONSTELLATION',
      kind: 'DEBUFF',
      name: 'ASH COUNT',
      description: '재를 세어 적의 방어를 무너뜨린다.',
      apCost: 2,
      target: 'ENEMY',
      power: 0.45,
      cooldown: 2,
      maxUses: null,
      applyStatusIds: ['def.down.great', 'burn'],
      special: '',
    },
  ],
  [
    {
      id: 'SK-NPC-C3',
      side: 'CONSTELLATION',
      kind: 'BUFF',
      name: 'GATELESS VOW',
      description: '문 없는 탑의 맹세로 헌터를 감싼다.',
      apCost: 2,
      target: 'PAIR',
      power: 0.25,
      cooldown: 1,
      maxUses: null,
      applyStatusIds: ['guard.up'],
      special: '',
    },
  ],
  [
    {
      id: 'SK-NPC-C4',
      side: 'CONSTELLATION',
      kind: 'UTILITY',
      name: 'FIRST NIGHT',
      description: '첫 번째 밤을 불러 적을 묶는다.',
      apCost: 2,
      target: 'ENEMY',
      power: 0,
      cooldown: 3,
      maxUses: 2,
      applyStatusIds: ['bind'],
      special: '',
    },
  ],
];
