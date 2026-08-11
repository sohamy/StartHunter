/**
 * 전투 생성과 조회 헬퍼.
 *
 * 상태를 직접 변형하지 않고 항상 새 객체를 돌려준다.
 */

import { SCHEMA_VERSION } from '../config/rules';
import {
  DEFAULT_OPERATION,
  DEFAULT_RAID_PAIR_COUNT,
  createBossEnemy,
  createMonsterEnemy,
  createPairState,
  emptySubmission,
} from '../config/scenario';
import type { BattleMode, BattleState, EnemyState, PairState } from '../types';

export interface CreateBattleOptions {
  mode?: BattleMode;
  /** RAID 에서 참가 페어 수. DUEL 은 항상 1 이다. */
  pairCount?: number;
  /** 보스 외에 일반 몬스터를 함께 배치할 수 있다. */
  monsterCount?: number;
  id?: string;
}

export function createBattle(options: CreateBattleOptions = {}): BattleState {
  const mode: BattleMode = options.mode ?? 'DUEL';
  const pairCount = mode === 'DUEL' ? 1 : Math.max(1, options.pairCount ?? DEFAULT_RAID_PAIR_COUNT);
  const monsterCount = Math.max(0, options.monsterCount ?? 0);

  const pairs: PairState[] = Array.from({ length: pairCount }, (_, index) =>
    createPairState(index),
  );

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
    viewerPairId: pairs[0].id,
    log: [],
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

export function clearSubmissions(pairs: PairState[], enemies: EnemyState[]): PairState[] {
  const fallbackTarget = enemies.find((enemy) => enemy.hp > 0)?.id ?? null;
  return pairs.map((pair) => ({
    ...pair,
    submission: { ...emptySubmission(), targetEnemyId: fallbackTarget },
  }));
}
