/**
 * 공략 기록 보관.
 *
 * 끝난 전투는 지우지 않고 기록으로 남긴다 — 결과 확인과 포인트 정산의 근거가 된다.
 * 기록은 스냅샷이므로 만든 뒤에는 전투 상태와 이어지지 않는다.
 */

import { SCHEMA_VERSION } from '../config/rules';
import type { BattleRecord, BattleRecordPair, BattleState, PairBond } from '../types';
import { addItem } from './items';
import { earnedBy } from './rewards';
import { injuryOf } from './status';

export function buildRecord(state: BattleState, at: Date, note = ''): BattleRecord {
  const pairs: BattleRecordPair[] = state.pairs.map((pair) => ({
    pairId: pair.id,
    label: pair.label,
    hunterName: pair.hunter.name,
    constellationName: pair.constellation.name,
    affiliation: pair.affiliation,
    hunterHp: pair.hunter.hp,
    hunterMaxHp: pair.hunter.maxHp,
    injury: injuryOf(pair.hunter).stage,
    constellationStage: pair.constellation.stage,
    contract: { ...pair.contract },
    pointsEarned: earnedBy(state, pair.id),
    pointsTotal: pair.points,
    inventory: pair.inventory.map((row) => ({ ...row })),
  }));

  return {
    id: `REC-${state.id}-${at.getTime()}`,
    schemaVersion: SCHEMA_VERSION,
    battleId: state.id,
    mode: state.mode,
    operation: { ...state.operation },
    status: state.status,
    rounds: state.round,
    finishedAt: at.toISOString(),
    bossName: state.enemies.find((enemy) => enemy.boss)?.name ?? null,
    gimmick: state.gimmick
      ? { label: state.gimmick.label, status: state.gimmick.status }
      : null,
    pairs,
    log: state.log.map((entry) => ({ ...entry })),
    note,
  };
}

/** 기록이 정산 대상인지 — 진행 중인 전투는 정산하지 않는다 */
export function settleable(record: BattleRecord): boolean {
  return record.status === 'CLEARED' || record.status === 'FAILED';
}

export interface SettlementRow {
  bondId: string;
  label: string;
  pointsBefore: number;
  pointsAfter: number;
  earned: number;
}

/**
 * 기록의 결과를 영구 편성에 반영한다.
 *
 * 전투 중 얻은 포인트를 편성 포인트에 더하고, 남은 보급품으로 가방을 덮어쓴다 —
 * 전투에서 쓴 아이템은 돌아오지 않는다.
 * 라벨로 짝을 맞춘다: 전투 페어 id 는 전투마다 새로 만들어지므로 편성 id 와 다르다.
 */
export function settle(
  record: BattleRecord,
  bonds: PairBond[],
): { bonds: PairBond[]; rows: SettlementRow[] } {
  const rows: SettlementRow[] = [];

  const next = bonds.map((bond) => {
    const row = record.pairs.find((candidate) => candidate.label === bond.label);
    if (!row || row.pointsEarned === 0) return bond;

    const before = bond.points ?? 0;
    const after = before + row.pointsEarned;

    // 전투에서 남은 개수로 맞춘다 — 소모된 만큼 편성 가방에서도 빠진다.
    let inventory: PairBond['inventory'] = [];
    for (const stack of row.inventory) {
      inventory = addItem(inventory, stack.itemId, stack.quantity);
    }

    rows.push({
      bondId: bond.id,
      label: bond.label,
      pointsBefore: before,
      pointsAfter: after,
      earned: row.pointsEarned,
    });

    return { ...bond, points: after, inventory };
  });

  return { bonds: next, rows };
}
