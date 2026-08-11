/**
 * 전투 프리셋.
 *
 * Phase 5 에서 운영진이 전투를 직접 생성하게 되면 이 값들은 기본 프리셋으로만 쓰인다.
 * DUEL(페어 1조 vs 몬스터)과 RAID(다수 페어 공동 공략)는 같은 데이터 구조를 쓴다.
 */

import { AP_RULES, CONSTELLATION_STAGES, HUNTER_DEFAULTS } from './rules';
import type {
  Affiliation,
  ConstellationStage,
  EnemyState,
  PairState,
  RoundSubmission,
} from '../types';

export const DEFAULT_OPERATION = {
  name: 'FIRST TOWER',
  floor: 37,
  threatLevel: 'A',
} as const;

/** 레이드 프리셋의 기본 페어 수 */
export const DEFAULT_RAID_PAIR_COUNT = 4;

interface PairPreset {
  hunterName: string;
  constellationName: string;
  affiliation: Affiliation;
  constellationStage?: ConstellationStage;
  hp?: number;
  points?: number;
}

/** 레이드 인원은 이 목록 순서대로 채운다. 부족하면 뒤에서 자동 생성한다. */
export const PAIR_PRESETS: PairPreset[] = [
  { hunterName: '서윤', constellationName: '겨울을 삼킨 별', affiliation: 'GOVERNMENT' },
  {
    hunterName: '한도경',
    constellationName: '재를 세는 자',
    affiliation: 'PRIVATE_GUILD',
    hp: 82,
  },
  {
    hunterName: '유리',
    constellationName: '문 없는 탑의 파수',
    affiliation: 'GOVERNMENT',
    constellationStage: 'UNSTABLE',
    hp: 61,
  },
  {
    hunterName: '차현',
    constellationName: '첫 번째 밤을 건넌 별',
    affiliation: 'PRIVATE_GUILD',
    hp: 35,
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

export function createPairState(index: number): PairState {
  const preset: PairPreset =
    PAIR_PRESETS[index] ??
    {
      hunterName: `헌터 ${index + 1}`,
      constellationName: `이름 없는 별 ${index + 1}`,
      affiliation: index % 2 === 0 ? 'GOVERNMENT' : 'PRIVATE_GUILD',
    };

  const stage = preset.constellationStage ?? 'STABLE';
  const constellationMaxAp = Math.max(
    0,
    AP_RULES.constellationMaxAp + CONSTELLATION_STAGES[stage].maxApDelta,
  );
  const maxHp = HUNTER_DEFAULTS.maxHp;

  return {
    id: `PAIR-${String(index + 1).padStart(2, '0')}`,
    label: `PAIR ${String(index + 1).padStart(2, '0')}`,
    affiliation: preset.affiliation,
    hunter: {
      name: preset.hunterName,
      hp: preset.hp ?? maxHp,
      maxHp,
      ap: AP_RULES.hunterMaxAp,
      maxAp: AP_RULES.hunterMaxAp,
      attack: HUNTER_DEFAULTS.attack,
      control: 'ACTIVE',
    },
    constellation: {
      name: preset.constellationName,
      ap: constellationMaxAp,
      maxAp: constellationMaxAp,
      stage,
      control: 'ACTIVE',
    },
    contract: {
      stage: 'RESONANCE',
      value: 88,
    },
    points: preset.points ?? 450,
    submission: emptySubmission(),
    patternRevealed: false,
  };
}

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
