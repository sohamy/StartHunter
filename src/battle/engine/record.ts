/**
 * 공략 기록 보관.
 *
 * 끝난 전투는 지우지 않고 기록으로 남긴다 — 결과 확인과 포인트 정산의 근거가 된다.
 * 기록은 스냅샷이므로 만든 뒤에는 전투 상태와 이어지지 않는다.
 */

import { SCHEMA_VERSION } from '../config/rules';
import { findItem } from '../config/items';
import type {
  ActorSide,
  BattleRecord,
  BattleRecordPair,
  BattleState,
  ItemStack,
  PairBond,
} from '../types';
import { addItem, quantityOf } from './items';
import { earnedOnlyBy, earnedShared } from './rewards';
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
    // 소지금과 가방은 사람마다 따로 남긴다 — 정산은 이 값을 그대로 시트에 옮긴다
    pointsEarned: earnedShared(state, pair.id),
    hunterPointsEarned: earnedOnlyBy(state, pair.id, 'HUNTER'),
    constellationPointsEarned: earnedOnlyBy(state, pair.id, 'CONSTELLATION'),
    hunterPoints: pair.hunter.points ?? 0,
    hunterInventory: (pair.hunter.inventory ?? []).map((row) => ({ ...row })),
    constellationPoints: pair.constellation.points ?? 0,
    constellationInventory: (pair.constellation.inventory ?? []).map((row) => ({ ...row })),
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
  accountId: string;
  /** 편성 라벨 — 어느 조의 결과인지 보여 준다 */
  label: string;
  name: string;
  pointsBefore: number;
  pointsAfter: number;
  earned: number;
}

/** 정산 대상 한 사람 — 시트가 그대로 이 모양이다 */
export interface SettlementTarget {
  accountId: string;
  side: ActorSide;
  points: number;
  inventory: ItemStack[];
}

/**
 * 기록의 결과를 **개인**에게 반영한다.
 *
 * 소지금과 가방은 사람마다 따로 굴러간다 — 전투 안에서도 합치지 않는다.
 * 그래서 정산은 나눌 것이 없다: 전투가 끝난 시점의 개인 소지금 · 가방을
 * 시트에 그대로 옮겨 적으면 된다. 쓴 것도, 운영진이 준 것도 이미 그 값에 들어 있다.
 *
 * 같은 기록을 두 번 정산해도 결과가 달라지지 않는다 (더하지 않고 맞춰 쓰므로).
 *
 * 라벨로 짝을 맞춘다: 전투 페어 id 는 전투마다 새로 만들어지므로 편성 id 와 다르다.
 */
export function settle(
  record: BattleRecord,
  bonds: PairBond[],
  targets: SettlementTarget[],
): { targets: SettlementTarget[]; rows: SettlementRow[] } {
  const rows: SettlementRow[] = [];
  const next = new Map(targets.map((row) => [row.accountId, { ...row }]));

  for (const bond of bonds) {
    const row = record.pairs.find((candidate) => candidate.label === bond.label);
    if (!row) continue;

    // 사람마다 나누기 전에 남긴 기록은 옛 방식으로 정산한다
    if (row.hunterPoints === undefined) {
      rows.push(...settleLegacy(row, bond, next));
      continue;
    }

    const members: Array<[string | null, string, number, ItemStack[], number]> = [
      [
        bond.hunterAccountId,
        row.hunterName,
        row.hunterPoints,
        row.hunterInventory ?? [],
        row.pointsEarned + (row.hunterPointsEarned ?? 0),
      ],
      [
        bond.constellationAccountId,
        row.constellationName,
        row.constellationPoints ?? 0,
        row.constellationInventory ?? [],
        row.pointsEarned + (row.constellationPointsEarned ?? 0),
      ],
    ];

    for (const [accountId, name, points, inventory, earned] of members) {
      const member = accountId ? next.get(accountId) : undefined;
      if (!member) continue;

      const before = member.points ?? 0;
      member.points = Math.max(0, points);
      member.inventory = inventory.map((stack) => ({ ...stack }));

      rows.push({
        accountId: member.accountId,
        label: bond.label,
        name,
        pointsBefore: before,
        pointsAfter: member.points,
        earned,
      });
    }
  }

  return { targets: [...next.values()], rows };
}

/**
 * 옛 기록(공용 가방 시절) 정산.
 *
 * 얻은 포인트를 두 사람에게 각자 주고, 전투에서 쓴 만큼을 각자의 가방에서 뺀다.
 *   쓴 양 = (두 사람 가방을 합친 것) − (전투가 끝났을 때 남은 것)
 *   전용 품목은 그 쪽에서 먼저 빼고, 공용은 가진 사람 쪽에서 뺀다
 */
function settleLegacy(
  row: BattleRecordPair,
  bond: PairBond,
  next: Map<string, SettlementTarget>,
): SettlementRow[] {
  const rows: SettlementRow[] = [];
  const hunter = bond.hunterAccountId ? next.get(bond.hunterAccountId) : undefined;
  const constellation = bond.constellationAccountId
    ? next.get(bond.constellationAccountId)
    : undefined;
  if (!hunter && !constellation) return rows;

  for (const [member, name] of [
    [hunter, row.hunterName],
    [constellation, row.constellationName],
  ] as Array<[SettlementTarget | undefined, string]>) {
    if (!member || row.pointsEarned === 0) continue;
    const before = member.points ?? 0;
    member.points = before + row.pointsEarned;
    rows.push({
      accountId: member.accountId,
      label: bond.label,
      name,
      pointsBefore: before,
      pointsAfter: member.points,
      earned: row.pointsEarned,
    });
  }

  let carried: ItemStack[] = [];
  for (const stack of [...(hunter?.inventory ?? []), ...(constellation?.inventory ?? [])]) {
    carried = addItem(carried, stack.itemId, stack.quantity);
  }

  for (const stack of carried) {
    const left = (row.inventory ?? []).find((candidate) => candidate.itemId === stack.itemId);
    let used = stack.quantity - (left?.quantity ?? 0);
    if (used <= 0) continue;

    const item = findItem(stack.itemId);
    const order: Array<SettlementTarget | undefined> =
      item?.category === 'CONSTELLATION_ONLY' ? [constellation, hunter] : [hunter, constellation];

    for (const member of order) {
      if (!member || used <= 0) continue;
      const have = quantityOf(member.inventory, stack.itemId);
      if (have <= 0) continue;
      const take = Math.min(have, used);
      member.inventory = addItem(member.inventory, stack.itemId, -take);
      used -= take;
    }
  }

  return rows;
}
