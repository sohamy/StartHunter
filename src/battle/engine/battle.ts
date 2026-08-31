/**
 * 전투 생성과 조회 헬퍼.
 *
 * 상태를 직접 변형하지 않고 항상 새 객체를 돌려준다.
 * 참가자 캐릭터든 프리셋 NPC 든 전투 상태는 모두 "시트 → 파생" 경로로 만든다.
 */

import { findGimmick } from '../config/gimmicks';
import { DEFAULT_INVENTORY, allowedFor, findItem } from '../config/items';
import { CONTRACT_RULES, MANIFEST_RULES, SCHEMA_VERSION } from '../config/rules';
import {
  DEFAULT_GIMMICK_ID,
  DEFAULT_OPERATION,
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
  ActorSide,
  Affiliation,
  BattleMode,
  BattleState,
  CharacterSheet,
  EnemyState,
  EnemyTemplate,
  GimmickState,
  ItemStack,
  PairBond,
  PairState,
} from '../types';
import { constellationStateFromSheet, hunterStateFromSheet } from './character';
import { newUuid } from './id';
import { contractFromValue, constellationMaxAp } from './status';

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
  /** 두 사람에게 각각 줄 소지금. 생략하면 시트에 적힌 개인 소지금을 그대로 쓴다 */
  points?: number;
  /** 두 사람이 각자 들고 들어갈 보급품. 생략하면 개인 가방을 그대로 들고 간다 */
  inventory?: ItemStack[];
}

/**
 * 전투에 들고 들어갈 가방을 정한다.
 *
 * 가방은 **개인 소유**다 — 두 사람 것을 합치지 않는다.
 * 빈손으로 들어가지 않도록, 가진 것이 없으면 기본 보급을 준다.
 * 기본 보급도 이 주체가 쓸 수 있는 것만 골라 준다 (성유물을 헌터에게 주지 않는다).
 */
export function startingBag(
  own: ItemStack[] | undefined,
  override: ItemStack[] | undefined,
  side: ActorSide,
  affiliation: Affiliation,
): ItemStack[] {
  const bag = override ?? own ?? [];
  if (bag.length > 0) return bag.map((row) => ({ ...row }));

  return DEFAULT_INVENTORY.filter((row) => {
    const item = findItem(row.itemId);
    return item ? allowedFor(item, side, affiliation) : false;
  }).map((row) => ({ ...row }));
}

export function createPair(index: number, input: PairInput): PairState {
  const affiliation = input.affiliation ?? input.hunterSheet.affiliation;
  const hunter = hunterStateFromSheet(input.hunterSheet);
  const constellation = constellationStateFromSheet(input.constellationSheet);

  // 소지금과 가방은 사람마다 따로다 — 시트에서 그대로 가져오고,
  // 프리셋 NPC 처럼 시트가 없는 경우에만 지정한 값을 쓴다.
  hunter.points = input.points ?? hunter.points;
  constellation.points = input.points ?? constellation.points;
  hunter.inventory = startingBag(hunter.inventory, input.inventory, 'HUNTER', affiliation);
  constellation.inventory = startingBag(
    constellation.inventory,
    input.inventory,
    'CONSTELLATION',
    affiliation,
  );

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
    // 서버의 battle_pairs.id 가 uuid 이므로 형식을 맞춘다. 표기는 label 을 쓴다.
    id: newUuid(),
    label: pairLabelFor(index),
    affiliation,
    hunterAccountId: input.hunterAccountId ?? null,
    constellationAccountId: input.constellationAccountId ?? null,
    hunter,
    constellation,
    contract: contractFromValue(CONTRACT_RULES.initialValue),
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
    identified: false,
    identifiedBy: [],
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
    rewards: [],
  };
}

/* ── 적 세팅 → 전투 배치 ───────────────────────────────── */

export function enemyFromTemplate(template: EnemyTemplate, index = 0): EnemyState {
  return {
    id: `${template.id}#${index}`,
    name: template.name,
    grade: template.grade,
    hp: template.maxHp,
    maxHp: template.maxHp,
    attack: template.attack,
    defense: template.defense,
    phase: 1,
    maxPhase: template.maxPhase,
    statuses: [],
    attacks: template.attacks ?? [],
    nextPattern: 'UNKNOWN',
    boss: template.boss,
    patternSetId: template.patternSetId,
    phaseCutoffs: template.phaseCutoffs ?? [],
    telegraph: null,
  };
}

/** 등록된 적을 템플릿으로 저장할 수 있게 역변환한다 */
export function templateFromEnemy(enemy: EnemyState): EnemyTemplate {
  return {
    id: enemy.id.split('#')[0],
    name: enemy.name,
    grade: enemy.grade,
    maxHp: enemy.maxHp,
    attack: enemy.attack,
    defense: enemy.defense,
    maxPhase: enemy.maxPhase,
    patternSetId: enemy.patternSetId,
    attacks: enemy.attacks ?? [],
    phaseCutoffs: enemy.phaseCutoffs ?? [],
    boss: enemy.boss,
  };
}

/* ── 영구 편성 → 전투 참가 ─────────────────────────────── */

export interface BondEntry {
  bond: PairBond;
  hunterSheet: CharacterSheet;
  constellationSheet: CharacterSheet;
}

export interface AssembleOptions {
  id: string;
  mode: BattleMode;
  operation?: BattleState['operation'];
  entries: BondEntry[];
  enemies: EnemyState[];
  gimmickId?: string | null;
}

/**
 * 등록된 페어와 세팅된 적으로 전투를 만든다.
 * 페어는 이미 맺어져 있으므로 여기서 짝을 짓지 않는다 — 참가 여부만 정한다.
 */
export function assembleBattle(options: AssembleOptions): BattleState {
  const pairs = options.entries.map((entry, index) => {
    const pair = createPair(index, {
      hunterSheet: entry.hunterSheet,
      constellationSheet: entry.constellationSheet,
      hunterAccountId: entry.bond.hunterAccountId,
      constellationAccountId: entry.bond.constellationAccountId,
      affiliation: entry.bond.affiliation,
      // 소지금과 가방은 개인 것이다 — 시트에 있는 것을 각자 그대로 들고 들어간다.
      // 합치지 않으므로 정산에서 나눌 일도 없다.
    });
    return { ...pair, label: entry.bond.label };
  });

  const firstEnemyId = options.enemies.find((enemy) => enemy.hp > 0)?.id ?? null;
  for (const pair of pairs) {
    pair.submission.targetEnemyId = firstEnemyId;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    id: options.id,
    mode: options.mode,
    operation: options.operation ?? { ...DEFAULT_OPERATION },
    round: 1,
    status: 'ENGAGED',
    pairs,
    enemies: options.enemies,
    gimmick: createGimmick(options.gimmickId ?? null),
    viewerPairId: pairs[0]?.id ?? '',
    log: [],
    alerts: [],
    rewards: [],
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
