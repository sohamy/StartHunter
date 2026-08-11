/**
 * 전투 프리셋.
 *
 * Phase 5 에서 운영진이 전투를 직접 생성하게 되면 이 값들은 기본 프리셋으로만 쓰인다.
 * DUEL(페어 1조 vs 몬스터)과 RAID(다수 페어 공동 공략)는 같은 데이터 구조를 쓴다.
 *
 * 프리셋 캐릭터도 참가자 캐릭터와 똑같이 "시트 → 파생" 경로를 통과한다.
 * NPC 만 다른 계산식을 쓰는 일이 생기지 않도록 하기 위한 것이다.
 */

import type {
  Affiliation,
  CharacterSheet,
  ConstellationStage,
  EnemyState,
  RoundSubmission,
  StatBlock,
} from '../types';

export const DEFAULT_OPERATION = {
  name: 'FIRST TOWER',
  floor: 37,
  threatLevel: 'A',
} as const;

/** 레이드 프리셋의 기본 페어 수 */
export const DEFAULT_RAID_PAIR_COUNT = 4;

interface PresetActor {
  name: string;
  classId: string;
  stats: StatBlock;
}

interface PairPreset {
  hunter: PresetActor;
  constellation: PresetActor;
  affiliation: Affiliation;
  constellationStage?: ConstellationStage;
  /** 시작 HP 비율 (0~1). 생략하면 만피 */
  hpRatio?: number;
  points?: number;
}

/** 레이드 인원은 이 목록 순서대로 채운다. 부족하면 뒤에서 자동 생성한다. */
export const PAIR_PRESETS: PairPreset[] = [
  {
    affiliation: 'GOVERNMENT',
    hunter: {
      name: '서윤',
      classId: 'striker',
      stats: { str: 5, vit: 4, agi: 3, sen: 2, wil: 3 },
    },
    constellation: {
      name: '겨울을 삼킨 별',
      classId: 'war',
      stats: { authority: 5, divinity: 4, resonance: 2, observation: 3, manifest: 3 },
    },
  },
  {
    affiliation: 'PRIVATE_GUILD',
    hpRatio: 0.82,
    hunter: {
      name: '한도경',
      classId: 'guardian',
      stats: { str: 2, vit: 6, agi: 4, sen: 2, wil: 3 },
    },
    constellation: {
      name: '재를 세는 자',
      classId: 'calamity',
      stats: { authority: 6, divinity: 3, resonance: 1, observation: 4, manifest: 3 },
    },
  },
  {
    affiliation: 'GOVERNMENT',
    hpRatio: 0.61,
    constellationStage: 'UNSTABLE',
    hunter: {
      name: '유리',
      classId: 'ranger',
      stats: { str: 4, vit: 3, agi: 4, sen: 5, wil: 1 },
    },
    constellation: {
      name: '문 없는 탑의 파수',
      classId: 'guard',
      stats: { authority: 4, divinity: 4, resonance: 5, observation: 2, manifest: 2 },
    },
  },
  {
    affiliation: 'PRIVATE_GUILD',
    hpRatio: 0.35,
    hunter: {
      name: '차현',
      classId: 'caster',
      stats: { str: 4, vit: 3, agi: 2, sen: 3, wil: 5 },
    },
    constellation: {
      name: '첫 번째 밤을 건넌 별',
      classId: 'omen',
      stats: { authority: 3, divinity: 5, resonance: 2, observation: 6, manifest: 1 },
    },
  },
];

export function emptySubmission(): RoundSubmission {
  return {
    hunterActionId: null,
    constellationActionId: null,
    targetEnemyId: null,
    submitted: false,
    auto: false,
  };
}

/** 프리셋을 캐릭터 시트 형태로 변환한다. */
export function presetSheet(
  actor: PresetActor,
  side: 'HUNTER' | 'CONSTELLATION',
  affiliation: Affiliation,
  index: number,
): CharacterSheet {
  return {
    id: `NPC-${side === 'HUNTER' ? 'H' : 'C'}-${index + 1}`,
    side,
    name: actor.name,
    classId: actor.classId,
    stats: actor.stats,
    concept: '운영 프리셋 캐릭터',
    affiliation,
    createdAt: '1970-01-01T00:00:00.000Z',
  };
}

export function pairPreset(index: number): PairPreset {
  return (
    PAIR_PRESETS[index] ?? {
      affiliation: index % 2 === 0 ? 'GOVERNMENT' : 'PRIVATE_GUILD',
      hunter: {
        name: `헌터 ${index + 1}`,
        classId: 'striker',
        stats: { str: 4, vit: 4, agi: 3, sen: 2, wil: 2 },
      },
      constellation: {
        name: `이름 없는 별 ${index + 1}`,
        classId: 'war',
        stats: { authority: 4, divinity: 4, resonance: 2, observation: 3, manifest: 3 },
      },
    }
  );
}

export function pairIdFor(index: number): string {
  return `PAIR-${String(index + 1).padStart(2, '0')}`;
}

export function pairLabelFor(index: number): string {
  return `PAIR ${String(index + 1).padStart(2, '0')}`;
}

export const DEFAULT_POINTS = 450;

export function createBossEnemy(pairCount: number): EnemyState {
  /** 레이드는 참가 페어 수에 비례해 HP 를 잡는다. */
  const hp = 400 + pairCount * 300;
  return {
    id: 'ENEMY-STAR-DEVOURER',
    name: '별을 먹는 짐승',
    grade: 'BOSS / A',
    hp,
    maxHp: hp,
    attack: 14,
    defense: 6,
    phase: 1,
    maxPhase: 3,
    statuses: [],
    nextPattern: 'SINGLE STRIKE',
    boss: true,
  };
}

export function createMonsterEnemy(index: number): EnemyState {
  return {
    id: `ENEMY-HUSK-${index + 1}`,
    name: `탑의 껍데기 ${index + 1}`,
    grade: 'NORMAL / C',
    hp: 180,
    maxHp: 180,
    attack: 9,
    defense: 3,
    phase: 1,
    maxPhase: 1,
    statuses: [],
    nextPattern: 'SINGLE STRIKE',
    boss: false,
  };
}

/** 프리셋 → PairState 변환은 engine/battle.ts 에서 시트 파생을 거쳐 처리한다. */
export type { PairPreset, PresetActor };
