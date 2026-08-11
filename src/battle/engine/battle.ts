/**
 * 전투 생성과 조회 헬퍼.
 *
 * 상태를 직접 변형하지 않고 항상 새 객체를 돌려준다.
 * 참가자 캐릭터든 프리셋 NPC 든 전투 상태는 모두 "시트 → 파생" 경로로 만든다.
 */

import { findGimmick } from '../config/gimmicks';
import { MANIFEST_RULES, SCHEMA_VERSION } from '../config/rules';
import {
  DEFAULT_GIMMICK_ID,
  DEFAULT_OPERATION,
  DEFAULT_POINTS,
  DEFAULT_RAID_PAIR_COUNT,
  createBossEnemy,
  createMonsterEnemy,
  emptySubmission,
  pairIdFor,
  pairLabelFor,
  pairPreset,
  presetSheet,
} from '../config/scenario';
import type {
  BattleMode,
  BattleState,
  CharacterSheet,
  EnemyState,
  GimmickState,
  PairState,
} from '../types';
import { constellationStateFromSheet, hunterStateFromSheet } from './character';
import { constellationMaxAp } from './status';

export interface PairInput {
  hunterSheet: CharacterSheet;
  constellationSheet: CharacterSheet;
  /** 헌터를 조작하는 계정 */
  hunterAccountId?: string | null;
  /** 성좌를 조작하는 계정 */
  constellationAccountId?: string | null;
  /** 생략하면 헌터 시트의 소속을 따른다 */
  affiliation?: PairState['affiliation'];
  hpRatio?: number;
  constellationStage?: PairState['constellation']['stage'];
  points?: number;
}

export function createPair(index: number, input: PairInput): PairState {
  const hunter = hunterStateFromSheet(input.hunterSheet);
  const constellation = constellationStateFromSheet(input.constellationSheet);
  constellation.manifestUses = {
    partial: MANIFEST_RULES.partialPerBattle,
    full: MANIFEST_RULES.fullPerCampaign,
  };

  if (input.hpRatio !== undefined) {
    hunter.hp = Math.max(0, Math.round(hunter.maxHp * input.hpRatio));
  }

  if (input.constellationStage) {
    constellation.stage = input.constellationStage;
    constellation.maxAp = constellationMaxAp(constellation.maxAp, input.constellationStage);
    constellation.ap = constellation.maxAp;
  }

  return {
    id: pairIdFor(index),
    label: pairLabelFor(index),
    affiliation: input.affiliation ?? input.hunterSheet.affiliation,
    hunterAccountId: input.hunterAccountId ?? null,
    constellationAccountId: input.constellationAccountId ?? null,
    hunter,
    constellation,
    contract: { stage: 'RESONANCE', value: 88 },
    points: input.points ?? DEFAULT_POINTS,
    submission: emptySubmission(),
    patternRevealed: false,
  };
}

/** 프리셋 인덱스로 페어를 만든다 (NPC 공략조) */
export function createPresetPair(index: number): PairState {
  const preset = pairPreset(index);
  return createPair(index, {
    hunterSheet: presetSheet(preset.hunter, 'HUNTER', preset.affiliation, index),
    constellationSheet: presetSheet(
      preset.constellation,
      'CONSTELLATION',
      preset.affiliation,
      index,
    ),
    affiliation: preset.affiliation,
    hpRatio: preset.hpRatio,
    constellationStage: preset.constellationStage,
    points: preset.points,
  });
}

export interface CreateBattleOptions {
  mode?: BattleMode;
  /** RAID 에서 참가 페어 수. DUEL 은 항상 1 이다. */
  pairCount?: number;
  /** 보스 외에 일반 몬스터를 함께 배치할 수 있다. */
  monsterCount?: number;
  id?: string;
  /** PAIR 01 자리에 들어갈 참가자 페어. 없으면 프리셋으로 채운다. */
  primaryPair?: PairInput;
  /** 층 기믹 id. 생략하면 기본 기믹, null 이면 기믹 없음 */
  gimmickId?: string | null;
}

export function createGimmick(defId: string | null): GimmickState | null {
  const def = findGimmick(defId ?? '');
  if (!def) return null;
  return {
    defId: def.id,
    label: def.label,
    labelKo: def.labelKo,
    description: def.description,
    required: def.required,
    progress: 0,
    roundsLeft: def.roundLimit,
    status: 'ACTIVE',
  };
}

export function createBattle(options: CreateBattleOptions = {}): BattleState {
  const mode: BattleMode = options.mode ?? 'DUEL';
  const pairCount = mode === 'DUEL' ? 1 : Math.max(1, options.pairCount ?? DEFAULT_RAID_PAIR_COUNT);
  const monsterCount = Math.max(0, options.monsterCount ?? 0);

  const pairs: PairState[] = Array.from({ length: pairCount }, (_, index) => {
    if (index === 0 && options.primaryPair) {
      return createPair(0, options.primaryPair);
    }
    return createPresetPair(index);
  });

  const enemies: EnemyState[] = [
    createBossEnemy(pairCount),
    ...Array.from({ length: monsterCount }, (_, index) => createMonsterEnemy(index)),
  ];

  const firstEnemyId = enemies[0].id;
  for (const pair of pairs) {
    pair.submission.targetEnemyId = firstEnemyId;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    id: options.id ?? `BATTLE-${mode}-${pairCount}`,
    mode,
    operation: { ...DEFAULT_OPERATION },
    round: 1,
    status: 'ENGAGED',
    pairs,
    enemies,
    gimmick: createGimmick(
      options.gimmickId === undefined ? DEFAULT_GIMMICK_ID : options.gimmickId,
    ),
    viewerPairId: pairs[0].id,
    log: [],
    alerts: [],
  };
}

export function getPair(state: BattleState, pairId: string): PairState | null {
  return state.pairs.find((pair) => pair.id === pairId) ?? null;
}

export function viewerPair(state: BattleState): PairState {
  return getPair(state, state.viewerPairId) ?? state.pairs[0];
}

export function getEnemy(state: BattleState, enemyId: string | null): EnemyState | null {
  if (!enemyId) return null;
  return state.enemies.find((enemy) => enemy.id === enemyId) ?? null;
}

export function aliveEnemies(state: BattleState): EnemyState[] {
  return state.enemies.filter((enemy) => enemy.hp > 0);
}

export function primaryEnemy(state: BattleState): EnemyState | null {
  const alive = aliveEnemies(state);
  return alive.find((enemy) => enemy.boss) ?? alive[0] ?? null;
}

/** 페어가 지정한 대상이 이미 쓰러졌다면 살아있는 적으로 대체한다. */
export function resolveTarget(state: BattleState, pair: PairState): EnemyState | null {
  const chosen = getEnemy(state, pair.submission.targetEnemyId);
  if (chosen && chosen.hp > 0) return chosen;
  return primaryEnemy(state);
}

export function activePairs(state: BattleState): PairState[] {
  return state.pairs.filter((pair) => pair.hunter.hp > 0);
}

/** 이 쪽이 제출을 마쳤는지 (자동 위임도 제출로 본다) */
export function sideReady(pair: PairState, side: 'HUNTER' | 'CONSTELLATION'): boolean {
  return side === 'HUNTER'
    ? pair.submission.hunterSubmitted || pair.hunter.control === 'AUTO'
    : pair.submission.constellationSubmitted || pair.constellation.control === 'AUTO';
}

/** 페어의 양쪽이 모두 준비되었는지 */
export function pairReady(pair: PairState): boolean {
  if (pair.hunter.hp <= 0) return sideReady(pair, 'CONSTELLATION');
  return sideReady(pair, 'HUNTER') && sideReady(pair, 'CONSTELLATION');
}

/** 이 계정이 이 페어에서 조작하는 쪽 */
export function sideOfAccount(
  pair: PairState,
  accountId: string | null,
): 'HUNTER' | 'CONSTELLATION' | null {
  if (!accountId) return null;
  if (pair.hunterAccountId === accountId) return 'HUNTER';
  if (pair.constellationAccountId === accountId) return 'CONSTELLATION';
  return null;
}

export function clearSubmissions(pairs: PairState[], enemies: EnemyState[]): PairState[] {
  const fallbackTarget = enemies.find((enemy) => enemy.hp > 0)?.id ?? null;
  return pairs.map((pair) => ({
    ...pair,
    submission: { ...emptySubmission(), targetEnemyId: fallbackTarget },
  }));
}
