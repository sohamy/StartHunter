/**
 * 라운드 처리.
 *
 * 흐름은 요구사항서 4장을 따른다.
 *   행동 확정 → 버프/디버프 → 헌터·성좌 행동 → 페어 연계
 *   → 적 행동(패턴) → 피해·상태이상 정산 → 기믹·페이즈 → 지속시간·쿨타임
 *
 * previewRound() 는 상태를 바꾸지 않고 예상 결과만 만든다.
 * applyRound() 는 preview 를 받아 실제 상태를 만든다.
 * 이 사이에 운영진 수정 단계(Phase 5)를 끼워 넣을 수 있어야 하므로 둘을 분리해 둔다.
 */

import { findGimmick } from '../config/gimmicks';
import { findItem } from '../config/items';
import { findPattern, type PatternDefinition } from '../config/patterns';
import {
  AP_RULES,
  CONSTELLATION_STAGES,
  CONTRACT_RULES,
  CURRENT_PHASE,
  HEAL_RULES,
  LAST_STAND_RULES,
  RESCUE_RULES,
} from '../config/rules';
import { findStatus, type StatusModifiers } from '../config/status';
import type {
  ActionDefinition,
  ActorSide,
  AlertLevel,
  BattleAlert,
  BattleState,
  EnemyActionPreview,
  EnemyState,
  GimmickCheck,
  GimmickStage,
  GimmickState,
  HunterState,
  ItemUse,
  LogEntry,
  PairPreview,
  PairState,
  RewardEntry,
  RoundPreview,
  StatusApplication,
  StatusEffect,
  StatusTick,
} from '../types';
import { decideAutoAction } from './auto';
import { clearSubmissions, resolveTarget } from './battle';
import { detectCombo } from './combo';
import { enemyAttackDamage, hunterAttackDamage } from './damage';
import { evaluatePhase, nextPatternLabel, selectPattern } from './enemy';
import { declarationValid, progressFrom } from './gimmick';
import {
  consumeItem,
  inventoryFor,
  itemApCost,
  itemAvailability,
  quantityOf,
  removeStatuses,
  resolveItem,
} from './items';
import { appendLog, createLogEntry } from './log';
import { applyGrants, clearRewards, grantFor, toEntries, type RewardGrant } from './rewards';
import { buildRoleplayText } from './roleplay';
import {
  consumeSkill,
  findSkillRuntime,
  resolveActionFor,
  skillAvailability,
  tickCooldowns,
} from './skills';
import {
  aggregateModifiers,
  applyStatus,
  canManifest,
  constellationMaxAp,
  contractFromValue,
  contractPowerMultiplier,
  injuryOf,
  isDown,
  shiftStage,
  tickStatuses,
} from './status';
import {
  buffAmplifier,
  canLastStand,
  contractRecovery,
  healBonus,
  manifestPower,
  protectAmplifier,
  recoilRelief,
  rescueBonus,
  revelationShared,
  statusDurationBonus,
  statusResistRounds,
  weakPointBonus,
} from './traits';

/* ── 보정치 합산 ───────────────────────────────────────── */

function mergeModifiers(...blocks: StatusModifiers[]): StatusModifiers {
  const total: StatusModifiers = {};
  for (const block of blocks) {
    for (const [key, value] of Object.entries(block)) {
      if (typeof value === 'number') {
        total[key as 'attackUp'] = ((total[key as 'attackUp'] ?? 0) as number) + value;
      } else if (value === true) {
        total[key as 'blockAction'] = true;
      }
    }
  }
  return total;
}

/* ── 선택 가능 여부 ────────────────────────────────────── */

export interface Availability {
  usable: boolean;
  reason?: string;
}

/** 이 주체가 이번 라운드에 고른 아이템 */
export function submittedItemId(pair: PairState, side: ActorSide): string | null {
  return side === 'HUNTER'
    ? pair.submission.hunterItemId
    : pair.submission.constellationItemId;
}

/**
 * 이 행동이 실제로 쓰는 행동력.
 * 아이템 행동은 행동 정의가 아니라 고른 아이템이 비용을 정한다.
 */
export function apCostOf(action: ActionDefinition, pair: PairState): number {
  if (action.kind !== 'ITEM') return action.apCost;
  const itemId = submittedItemId(pair, action.side);
  return itemId ? itemApCost(itemId) : action.apCost;
}

export function actionAvailability(
  action: ActionDefinition,
  pair: PairState,
  hasTarget: boolean,
  /**
   * 이 층의 기믹. 없거나 이미 끝났으면 기믹 수행을 고를 수 없다.
   * 넘기지 않으면 확인하지 않는다 — 기믹을 모르는 화면도 이 함수를 쓴다.
   */
  gimmick?: GimmickState | null,
): Availability {
  if (action.implementedIn > CURRENT_PHASE) {
    return { usable: false, reason: '아직 구현되지 않은 행동' };
  }

  const actor = action.side === 'HUNTER' ? pair.hunter : pair.constellation;
  const apCost = apCostOf(action, pair);
  if (apCost > actor.ap) {
    return { usable: false, reason: `행동력 부족 (필요 ${apCost})` };
  }

  // 커스텀 스킬이면 쿨타임과 남은 사용 횟수를 확인한다.
  const skill = findSkillRuntime(pair, action.side, action.id);
  if (skill) {
    const availability = skillAvailability(skill);
    if (!availability.usable) return availability;
  }

  if (action.side === 'HUNTER' && isDown(pair.hunter) && action.kind !== 'WAIT') {
    return { usable: false, reason: '전투 불능' };
  }

  if (aggregateModifiers(actor.statuses).blockAction && action.kind !== 'WAIT') {
    return { usable: false, reason: '행동 불가 상태' };
  }

  // 아이템 행동은 "쓸 수 있는 물건이 가방에 있는가"까지가 행동 선택 조건이다.
  // 어떤 아이템을 쓸지는 선택 후에 고르므로, 개별 아이템 검사는 확정 단계에서 한다.
  if (action.kind === 'ITEM') {
    const rows = inventoryFor(pair, action.side).filter(
      (row) => row.item.combatUsable && row.quantity > 0,
    );
    if (rows.length === 0) {
      return { usable: false, reason: '쓸 수 있는 아이템이 없습니다' };
    }
    if (rows.every((row) => row.item.apCost > actor.ap)) {
      return { usable: false, reason: '행동력이 모자라 쓸 아이템이 없습니다' };
    }
  }

  if (action.side === 'CONSTELLATION') {
    if (pair.constellation.stage === 'LOST' && action.kind !== 'WAIT') {
      return { usable: false, reason: '성좌 소멸' };
    }
    if (action.kind === 'MANIFEST' || action.kind === 'FULL_MANIFEST') {
      if (!canManifest(pair.constellation.stage, pair.contract.stage)) {
        return { usable: false, reason: '현재 성좌 · 계약 상태로는 현신 불가' };
      }
      const uses =
        action.kind === 'MANIFEST'
          ? pair.constellation.manifestUses.partial
          : pair.constellation.manifestUses.full;
      if (uses !== null && uses <= 0) {
        return { usable: false, reason: '현신 사용 횟수 소진' };
      }
    }
  }

  if (action.kind === 'GIMMICK' && gimmick !== undefined) {
    if (!gimmick) return { usable: false, reason: '이 층에는 장치가 없습니다' };
    if (gimmick.status !== 'ACTIVE') {
      return { usable: false, reason: gimmick.status === 'CLEARED' ? '이미 해제됨' : '해제 실패' };
    }
  }

  if (action.target === 'ENEMY' && !hasTarget) {
    return { usable: false, reason: '대상 없음' };
  }

  return { usable: true };
}

/* ── 행동 확정 ─────────────────────────────────────────── */

interface ResolvedAction {
  action: ActionDefinition;
  auto: boolean;
  reason?: string;
}

/**
 * 행동 선택 조건과 고른 아이템의 조건을 함께 본다.
 * 아이템을 고르지 않았거나 다 써버렸으면 자동 행동으로 떨어져야 한다.
 */
function itemAware(
  action: ActionDefinition,
  pair: PairState,
  enemy: EnemyState | null,
  supportPair: PairState | null,
  gimmick: GimmickState | null,
): Availability {
  const base = actionAvailability(action, pair, Boolean(enemy), gimmick);
  if (!base.usable || action.kind !== 'ITEM') return base;
  return itemAvailability(
    pair,
    action.side,
    submittedItemId(pair, action.side),
    Boolean(enemy),
    supportPair,
  );
}

function resolveActorAction(
  side: ActorSide,
  pair: PairState,
  enemy: EnemyState | null,
  supportPair: PairState | null = null,
  gimmick: GimmickState | null = null,
): ResolvedAction {
  const submittedId =
    side === 'HUNTER' ? pair.submission.hunterActionId : pair.submission.constellationActionId;
  const control = side === 'HUNTER' ? pair.hunter.control : pair.constellation.control;
  const hasSubmitted =
    side === 'HUNTER'
      ? pair.submission.hunterSubmitted
      : pair.submission.constellationSubmitted;
  const submitted = hasSubmitted ? resolveActionFor(pair, side, submittedId) : null;

  if (control === 'ACTIVE' && submitted) {
    const availability = itemAware(submitted, pair, enemy, supportPair, gimmick);
    if (availability.usable) {
      return { action: submitted, auto: false };
    }
    const auto = decideAutoAction(side, { pair, enemy });
    return {
      action: auto.action,
      auto: true,
      reason: `선택한 행동 사용 불가(${availability.reason}) — ${auto.reason}`,
    };
  }

  const auto = decideAutoAction(side, { pair, enemy });
  const prefix = control === 'AUTO' ? '자동 행동' : '미제출';
  return { action: auto.action, auto: true, reason: `${prefix} — ${auto.reason}` };
}

/* ── 상태이상 부여 계산 ────────────────────────────────── */

interface StatusPlan {
  hunterStatuses: StatusEffect[];
  constellationStatuses: StatusEffect[];
  enemyStatuses: StatusEffect[];
  applied: StatusApplication[];
  notes: string[];
}

/**
 * 클래스 · 권역 특성이 상태이상 부여에 개입하는 값.
 * 어느 클래스가 무엇을 주는지는 engine/traits.ts 가 알고, 여기서는 결과만 받는다.
 */
interface StatusTraitContext {
  /** 적에게 거는 상태이상의 지속 라운드 추가 (재앙 권역) */
  enemyDurationBonus: number;
  /** 피해 감소 상태이상을 걸 때의 효과 배율 (수호 권역 · 방어 전담형) */
  guardAmplifier: number;
  /** 보호 행동으로 걸 때의 효과 배율 */
  protectAmplifier: number;
}

function planStatuses(
  pair: PairState,
  enemy: EnemyState | null,
  supportPair: PairState | null,
  actions: Array<{ action: ActionDefinition; scaleBuff: number; scaleDebuff: number }>,
  extraStatusIds: string[],
  traits: StatusTraitContext,
): StatusPlan {
  const plan: StatusPlan = {
    hunterStatuses: pair.hunter.statuses,
    constellationStatuses: pair.constellation.statuses,
    enemyStatuses: enemy?.statuses ?? [],
    applied: [],
    notes: [],
  };

  const queue: Array<{
    defId: string;
    scaleBuff: number;
    scaleDebuff: number;
    label: string;
    holderOverride?: 'HUNTER';
    ownerOverride?: string;
    viaProtect: boolean;
  }> = [];

  for (const { action, scaleBuff, scaleDebuff } of actions) {
    for (const defId of action.effect.applyStatusIds ?? []) {
      // 보호는 지정한 페어의 헌터에게 걸린다
      const ownerOverride =
        action.kind === 'PROTECT' && supportPair ? supportPair.id : undefined;
      queue.push({
        defId,
        scaleBuff,
        scaleDebuff,
        label: action.label,
        holderOverride: action.effect.statusHolder === 'HUNTER' ? 'HUNTER' : undefined,
        ownerOverride,
        viaProtect: action.kind === 'PROTECT',
      });
    }
  }

  // 연계로 추가되는 상태이상
  for (const defId of extraStatusIds) {
    queue.push({ defId, scaleBuff: 1, scaleDebuff: 1, label: 'PAIR LINK', viaProtect: false });
  }

  for (const item of queue) {
    const def = findStatus(item.defId);
    if (!def) continue;

    const holder = item.holderOverride ?? def.appliesTo;
    let scale = def.kind === 'BUFF' ? item.scaleBuff : item.scaleDebuff;

    // 피해 감소를 부여하는 상태이상만 보호 · 수호 특성의 영향을 받는다.
    if (def.modifiers.damageReduction) {
      scale *= item.viaProtect ? traits.protectAmplifier : traits.guardAmplifier;
    }
    scale = round2(scale);

    const durationBonus = holder === 'ENEMY' ? traits.enemyDurationBonus : 0;
    const duration = Math.max(1, def.duration + durationBonus);

    if (holder === 'ENEMY') {
      if (!enemy) continue;
      plan.enemyStatuses = applyStatus(
        plan.enemyStatuses,
        item.defId,
        item.label,
        scale,
        durationBonus,
      );
      plan.applied.push({
        holder,
        ownerId: enemy.id,
        defId: item.defId,
        label: def.label,
        scale,
        durationBonus,
      });
    } else if (holder === 'HUNTER') {
      const ownerId = item.ownerOverride ?? pair.id;
      if (ownerId === pair.id) {
        plan.hunterStatuses = applyStatus(plan.hunterStatuses, item.defId, item.label, scale);
      }
      plan.applied.push({ holder, ownerId, defId: item.defId, label: def.label, scale });
    } else {
      plan.constellationStatuses = applyStatus(
        plan.constellationStatuses,
        item.defId,
        item.label,
        scale,
      );
      plan.applied.push({ holder, ownerId: pair.id, defId: item.defId, label: def.label, scale });
    }

    plan.notes.push(
      `${def.label} 부여 (${duration}R${scale !== 1 ? ` · ×${round2(scale)}` : ''})`,
    );
  }

  return plan;
}

/* ── 페어 예상 결과 ────────────────────────────────────── */

/** 이 페어에서 이번 라운드에 통하는 특성 값 */
interface PairTraits extends StatusTraitContext {
  buffAmplifier: number;
  healBonus: number;
  rescueBonus: number;
  manifestPower: number;
  recoilRelief: number;
  weakPointBonus: number;
  revelationShared: boolean;
  contractRecovery: number;
}

function pairTraits(pair: PairState, enemy: EnemyState | null): PairTraits {
  // 약점 공격 판정은 "받는 피해가 늘어난 상태"를 약점으로 본다 —
  // 상태이상 이름을 엔진에 적지 않기 위한 것이다.
  const enemyIsWeak = (enemy?.statuses ?? []).some((effect) => {
    const def = findStatus(effect.defId);
    return Boolean(def?.modifiers.damageTaken);
  });

  return {
    enemyDurationBonus: statusDurationBonus(pair.constellation),
    guardAmplifier: protectAmplifier(pair.hunter, pair.constellation, false),
    protectAmplifier: protectAmplifier(pair.hunter, pair.constellation, true),
    buffAmplifier: buffAmplifier(pair.hunter),
    healBonus: healBonus(pair.hunter, pair.constellation),
    rescueBonus: rescueBonus(pair.hunter, pair.constellation),
    manifestPower: manifestPower(pair.constellation),
    recoilRelief: recoilRelief(pair.constellation),
    weakPointBonus: weakPointBonus(pair.hunter, enemyIsWeak),
    revelationShared: revelationShared(pair.constellation),
    contractRecovery: contractRecovery(pair.constellation),
  };
}

/** 현신은 계약에 반동을 남긴다. 현신 스탯이 그 반동을 깎는다. */
function manifestRecoil(action: ActionDefinition, relief: number): number {
  const base =
    action.kind === 'MANIFEST'
      ? CONTRACT_RULES.events.partialManifest
      : action.kind === 'FULL_MANIFEST'
        ? CONTRACT_RULES.events.fullManifest
        : 0;
  if (base === 0) return 0;
  return Math.round(base * (1 - relief));
}

function previewPair(state: BattleState, pair: PairState): PairPreview {
  const enemy = resolveTarget(state, pair);
  const notes: string[] = [];
  const traits = pairTraits(pair, enemy);

  // 지원 대상 (보호 · 구조 · 회복 아이템)
  const supportPair =
    state.pairs.find((row) => row.id === pair.submission.supportTargetPairId) ?? null;

  const empty: PairPreview = {
    pairId: pair.id,
    pairLabel: pair.label,
    hunterActionId: null,
    hunterActionLabel: '—',
    constellationActionId: null,
    constellationActionLabel: '—',
    usedSkills: [],
    appliedStatuses: [],
    combo: null,
    rescue: null,
    heals: [],
    itemUses: [],
    itemDamageToEnemy: 0,
    contractDelta: 0,
    stageDrop: 0,
    rewards: [],
    gimmickProgress: 0,
    gimmickNote: null,
    gimmickCheck: null,
    gimmickIdentified: false,
    autoFilled: [],
    targetEnemyId: enemy?.id ?? null,
    apSpent: { hunter: 0, constellation: 0 },
    damageToEnemy: 0,
    damageReduction: 0,
    revealPattern: false,
    notes,
    skipped: false,
  };

  if (isDown(pair.hunter)) {
    // 헌터가 쓰러져도 성좌는 계속 행동할 수 있다 (구조 지원 등)
    notes.push('헌터 전투 불능 — 구조를 기다립니다');
    const constellationResolved = resolveActorAction(
      'CONSTELLATION',
      pair,
      enemy,
      supportPair,
      state.gimmick,
    );
    const stagePenalty = CONSTELLATION_STAGES[pair.constellation.stage];
    const contractScale = contractPowerMultiplier(pair.contract.stage);
    const buffScale = round2(
      pair.constellation.power * stagePenalty.buffPowerMultiplier * contractScale,
    );
    const debuffScale = round2(
      pair.constellation.power * stagePenalty.debuffPowerMultiplier * contractScale,
    );
    const plan = planStatuses(
      pair,
      enemy,
      null,
      [{ action: constellationResolved.action, scaleBuff: buffScale, scaleDebuff: debuffScale }],
      [],
      traits,
    );
    notes.push(...plan.notes);

    const itemOutcome = resolveItemFor(
      pair,
      'CONSTELLATION',
      constellationResolved,
      enemy,
      supportPair,
      traits,
    );
    if (itemOutcome) notes.push(...itemOutcome.effects);

    // 계약자가 쓰러져 있는 동안에도 공명은 계약을 붙잡는다 — 다만 손실이 더 크다.
    const contractDelta = Math.round(
      CONTRACT_RULES.recoveryPerRound +
        traits.contractRecovery +
        CONTRACT_RULES.events.hunterDown +
        (itemOutcome?.contractRepair ?? 0),
    );

    return {
      ...empty,
      constellationActionId: constellationResolved.action.id,
      constellationActionLabel: constellationResolved.action.label,
      autoFilled: constellationResolved.auto ? ['CONSTELLATION'] : [],
      apSpent: { hunter: 0, constellation: apCostOf(constellationResolved.action, pair) },
      appliedStatuses: plan.applied,
      revealPattern: Boolean(constellationResolved.action.effect.revealPattern),
      heals: itemOutcome && itemOutcome.healAmount > 0 ? healRow(state, itemOutcome) : [],
      itemUses: itemOutcome ? [itemOutcome] : [],
      itemDamageToEnemy: itemOutcome?.damage ?? 0,
      stageDrop: -(itemOutcome?.stageRepair ?? 0),
      contractDelta,
      usedSkills: findSkillRuntime(pair, 'CONSTELLATION', constellationResolved.action.id)
        ? [{ side: 'CONSTELLATION', skillId: constellationResolved.action.id }]
        : [],
      skipped: true,
      skipReason: 'HUNTER DOWN',
    };
  }

  const hunterResolved = resolveActorAction('HUNTER', pair, enemy, supportPair, state.gimmick);
  const constellationResolved = resolveActorAction(
    'CONSTELLATION',
    pair,
    enemy,
    supportPair,
    state.gimmick,
  );
  const autoFilled: ActorSide[] = [];
  if (hunterResolved.auto) autoFilled.push('HUNTER');
  if (constellationResolved.auto) autoFilled.push('CONSTELLATION');

  if (hunterResolved.reason) notes.push(`HUNTER: ${hunterResolved.reason}`);
  if (constellationResolved.reason) notes.push(`CONSTELLATION: ${constellationResolved.reason}`);

  // 성좌의 권능 배율 · 존재 상태 보정 · 계약 단계 보정
  const stagePenalty = CONSTELLATION_STAGES[pair.constellation.stage];
  const contractScale = contractPowerMultiplier(pair.contract.stage);
  const buffScale = round2(
    pair.constellation.power * stagePenalty.buffPowerMultiplier * contractScale,
  );
  const debuffScale = round2(
    pair.constellation.power * stagePenalty.debuffPowerMultiplier * contractScale,
  );
  if (contractScale !== 1) {
    notes.push(`계약 ${pair.contract.stage} — 권능 ×${round2(contractScale)}`);
  }

  // 페어 연계 판정 — 행동 조합과 대상 상태로 결정된다
  const combo = detectCombo({
    hunterAction: hunterResolved.action,
    constellationAction: constellationResolved.action,
    enemyStatuses: enemy?.statuses ?? [],
  });
  if (combo) {
    notes.push(`PAIR LINK ${combo.definition.label} — ${combo.view.effects.join(' / ')}`);
  }

  // 1) 버프 / 디버프 처리 — 이번 라운드 행동에 바로 반영된다
  //    레이드에서는 페어마다 독립적으로 계산한다. 같은 라운드에 다른 페어가 건
  //    디버프는 다음 라운드부터 반영된다.
  const plan = planStatuses(
    pair,
    enemy,
    supportPair,
    [
      { action: constellationResolved.action, scaleBuff: buffScale, scaleDebuff: debuffScale },
      { action: hunterResolved.action, scaleBuff: 1, scaleDebuff: 1 },
    ],
    combo?.effect.applyStatusIds ?? [],
    traits,
  );
  notes.push(...plan.notes);

  const constellationEffect = constellationResolved.action.effect;
  const hunterEffect = hunterResolved.action.effect;

  // 권능 술사형은 성좌가 내려주는 공격력 버프를 더 크게 받는다
  const grantedAttackUp = (constellationEffect.attackUp ?? 0) * buffScale * traits.buffAmplifier;
  if (grantedAttackUp > 0 && traits.buffAmplifier !== 1) {
    notes.push(`권능 증폭 ×${round2(traits.buffAmplifier)} → 공격력 ${signed(grantedAttackUp)}`);
  }
  if (traits.weakPointBonus > 0) {
    notes.push(`약점 공격 보정 ${signed(traits.weakPointBonus)}`);
  }

  const hunterMods = mergeModifiers(aggregateModifiers(plan.hunterStatuses), {
    attackUp: grantedAttackUp + (combo?.effect.damageBonus ?? 0) + traits.weakPointBonus,
  });
  const enemyMods = mergeModifiers(aggregateModifiers(plan.enemyStatuses), {
    defenseDown:
      (constellationEffect.enemyDefenseDown ?? 0) * debuffScale + (combo?.effect.ignoreDefense ?? 0),
  });

  // 2) 헌터 · 성좌 행동 처리
  let damageToEnemy = 0;

  if (hunterEffect.damage && enemy) {
    const result = hunterAttackDamage({
      hunter: pair.hunter,
      enemy,
      powerRatio: hunterEffect.damage,
      hunterModifiers: hunterMods,
      enemyModifiers: enemyMods,
    });
    damageToEnemy = result.amount;
    notes.push(...result.notes);
  }

  if (constellationEffect.damage && enemy) {
    // 현신은 성좌의 현신 스탯이 위력에 개입한다
    const manifesting =
      constellationResolved.action.kind === 'MANIFEST' ||
      constellationResolved.action.kind === 'FULL_MANIFEST';
    const powerRatio = manifesting
      ? constellationEffect.damage * traits.manifestPower
      : constellationEffect.damage;
    const result = hunterAttackDamage({
      hunter: pair.hunter,
      enemy,
      powerRatio,
      hunterModifiers: hunterMods,
      enemyModifiers: enemyMods,
    });
    damageToEnemy += result.amount;
    notes.push(
      manifesting
        ? `현신 피해 ${result.amount} (현신 스탯 ×${round2(traits.manifestPower)})`
        : `성좌 개입 피해 ${result.amount}`,
    );
  }

  if (combo?.effect.counterDamage && enemy) {
    damageToEnemy += combo.effect.counterDamage;
    notes.push(`연계 반격 ${combo.effect.counterDamage}`);
  }

  const damageReduction =
    (hunterEffect.damageReduction ?? 0) + (combo?.effect.damageReduction ?? 0);
  if (damageReduction > 0) {
    notes.push(`방어 확보 — 받는 피해 ${Math.round(damageReduction * 100)}% 감소`);
  }

  // 3) 회복 — 회복 스킬은 최대 HP 비율로 돌려준다
  const heals: PairPreview['heals'] = [];
  for (const [side, resolved] of sides(hunterResolved, constellationResolved)) {
    const ratio = resolved.action.effect.heal;
    if (!ratio) continue;
    const target = resolved.action.target === 'ALLY' ? supportPair ?? pair : pair;
    if (aggregateModifiers(target.hunter.statuses).healBlock) {
      notes.push(`${target.label} 회복 차단 상태 — 회복 무효`);
      continue;
    }
    const amount = Math.max(
      HEAL_RULES.minimumHeal,
      Math.round(target.hunter.maxHp * ratio * HEAL_RULES.percentPerPower * (1 + traits.healBonus)),
    );
    heals.push({
      targetPairId: target.id,
      targetLabel: target.label,
      amount,
      sourceLabel: `${side} ${resolved.action.label}`,
    });
    notes.push(`${target.label} 회복 +${amount}`);
  }

  // 4) 아이템 — 비용과 대상은 아이템 정의가 정한다
  const itemUses: ItemUse[] = [];
  const itemStatuses: StatusApplication[] = [];
  let itemDamageToEnemy = 0;
  let itemContractRepair = 0;
  let itemStageRepair = 0;
  for (const [side, resolved] of sides(hunterResolved, constellationResolved)) {
    const use = resolveItemFor(pair, side, resolved, enemy, supportPair, traits);
    if (!use) continue;
    itemUses.push(use);
    itemDamageToEnemy += use.damage;
    itemContractRepair += use.contractRepair;
    itemStageRepair += use.stageRepair;
    if (use.healAmount > 0) heals.push(...healRow(state, use));
    notes.push(...use.effects);

    // 아이템이 거는 상태이상도 행동과 같은 경로로 흘려보낸다 —
    // 그래야 다음 라운드 보정과 로그가 자동으로 따라온다.
    for (const defId of use.applyStatusIds) {
      const def = findStatus(defId);
      if (!def) continue;
      if (def.appliesTo === 'ENEMY') {
        if (!enemy) continue;
        itemStatuses.push({
          holder: 'ENEMY',
          ownerId: enemy.id,
          defId,
          label: def.label,
          scale: 1,
          durationBonus: traits.enemyDurationBonus,
        });
      } else if (def.appliesTo === 'HUNTER') {
        itemStatuses.push({
          holder: 'HUNTER',
          ownerId: use.targetPairId ?? pair.id,
          defId,
          label: def.label,
          scale: 1,
        });
      } else {
        itemStatuses.push({
          holder: 'CONSTELLATION',
          ownerId: pair.id,
          defId,
          label: def.label,
          scale: 1,
        });
      }
    }
  }

  // 5) 구조
  let rescue: PairPreview['rescue'] = null;
  if (hunterResolved.action.kind === 'RESCUE') {
    const target = supportPair ?? state.pairs.find((row) => row.hunter.hp <= 0) ?? null;
    if (target && target.hunter.hp <= 0) {
      const ratio =
        RESCUE_RULES.revivePercent * (1 + (combo?.effect.rescueBonus ?? 0) + traits.rescueBonus);
      const restoredHp = Math.max(1, Math.round(target.hunter.maxHp * ratio));
      rescue = { targetPairId: target.id, targetLabel: target.label, restoredHp };
      notes.push(`구조 대상 ${target.label} — HP ${restoredHp} 회복`);
      if (traits.rescueBonus > 0) notes.push(`구조 보정 ${signed(traits.rescueBonus)}`);
    } else {
      notes.push('구조 대상 없음 — 행동이 소모되지 않습니다');
    }
  }

  // 6) 기믹 — 파악(INSIGHT) → 해결(RESOLVE)
  //    선언 없는 시도는 인정하지 않고, 판정은 확정 시점에 굴린 값을 쓴다.
  let gimmickProgress = 0;
  let gimmickIdentified = false;
  const gimmickCheck = pair.submission.gimmickCheck;
  const gimmickNote = pair.submission.gimmickNote;

  if (hunterResolved.action.kind === 'GIMMICK' && state.gimmick?.status === 'ACTIVE') {
    if (!declarationValid(gimmickNote)) {
      notes.push('기믹 선언 없음 — 진행으로 인정되지 않습니다');
    } else if (!gimmickCheck) {
      notes.push('기믹 판정 기록 없음 — 관리국 수동 판정 필요');
    } else if (gimmickCheck.stage === 'INSIGHT') {
      gimmickIdentified = gimmickCheck.success;
      notes.push(
        `기믹 파악 판정 ${gimmickCheck.total} vs ${gimmickCheck.dc} — ${
          gimmickCheck.success ? '성공' : '실패'
        }`,
      );
    } else {
      gimmickProgress = progressFrom(gimmickCheck) + (combo?.effect.gimmickBonus ?? 0);
      notes.push(
        `기믹 해결 판정 ${gimmickCheck.total} vs ${gimmickCheck.dc} — ${
          gimmickCheck.critical ? '대성공' : gimmickCheck.success ? '성공' : '실패'
        } (진행 +${gimmickProgress})`,
      );
    }
  }

  // 7) 계약 안정도 — 공명이 회복시키고, 현신과 사건이 깎는다
  let contractDelta = CONTRACT_RULES.recoveryPerRound + traits.contractRecovery;
  const recoil = manifestRecoil(constellationResolved.action, traits.recoilRelief);
  if (recoil !== 0) {
    contractDelta += recoil;
    notes.push(`현신 반동 ${recoil} (경감 ${Math.round(traits.recoilRelief * 100)}%)`);
  }
  if (combo) contractDelta += CONTRACT_RULES.events.comboLinked;
  if (rescue) contractDelta += CONTRACT_RULES.events.rescueCompleted;
  contractDelta = Math.round(contractDelta + itemContractRepair);

  const nextContractValue = pair.contract.value + contractDelta;
  const crossedThreshold =
    nextContractValue < CONTRACT_RULES.stageDropBelow &&
    pair.contract.value >= CONTRACT_RULES.stageDropBelow;
  if (crossedThreshold) {
    notes.push('계약이 임계선 아래로 내려갑니다 — 성좌 상태 한 단계 하락');
  }
  const stageDrop = (crossedThreshold ? 1 : 0) - itemStageRepair;

  // 8) 보상 — 구조는 즉시 인정한다. 층 클리어는 종료 판정에서 지급한다.
  const rewards: PairPreview['rewards'] = [];
  if (rescue) {
    const grant = grantFor(pair.id, 'PAIR_RESCUE');
    rewards.push({ reason: grant.reason, label: grant.label, points: grant.points });
  }

  // 사용한 커스텀 스킬 기록
  const usedSkills: PairPreview['usedSkills'] = [];
  if (findSkillRuntime(pair, 'HUNTER', hunterResolved.action.id)) {
    usedSkills.push({ side: 'HUNTER', skillId: hunterResolved.action.id });
  }
  if (findSkillRuntime(pair, 'CONSTELLATION', constellationResolved.action.id)) {
    usedSkills.push({ side: 'CONSTELLATION', skillId: constellationResolved.action.id });
  }

  return {
    ...empty,
    hunterActionId: hunterResolved.action.id,
    hunterActionLabel: hunterResolved.action.label,
    constellationActionId: constellationResolved.action.id,
    constellationActionLabel: constellationResolved.action.label,
    usedSkills,
    appliedStatuses: [...plan.applied, ...itemStatuses],
    combo: combo?.view ?? null,
    rescue,
    heals,
    itemUses,
    itemDamageToEnemy,
    contractDelta,
    stageDrop,
    rewards,
    gimmickProgress,
    gimmickNote,
    gimmickCheck,
    gimmickIdentified,
    autoFilled,
    apSpent: {
      hunter: apCostOf(hunterResolved.action, pair),
      constellation: apCostOf(constellationResolved.action, pair),
    },
    damageToEnemy,
    damageReduction,
    revealPattern: Boolean(constellationEffect.revealPattern),
    notes,
  };
}

/** 헌터 · 성좌를 같은 방식으로 순회하기 위한 짝 */
function sides(
  hunterResolved: ResolvedAction,
  constellationResolved: ResolvedAction,
): Array<[ActorSide, ResolvedAction]> {
  return [
    ['HUNTER', hunterResolved],
    ['CONSTELLATION', constellationResolved],
  ];
}

/** 아이템 행동이면 결과를 계산한다. 아이템 행동이 아니면 null. */
function resolveItemFor(
  pair: PairState,
  side: ActorSide,
  resolved: ResolvedAction,
  enemy: EnemyState | null,
  supportPair: PairState | null,
  traits: PairTraits,
): ItemUse | null {
  if (resolved.action.kind !== 'ITEM') return null;
  const itemId = submittedItemId(pair, side);
  if (!itemId) return null;
  return resolveItem(
    pair,
    side,
    itemId,
    { enemyId: enemy?.id ?? null, supportPair },
    traits.healBonus,
  );
}

function healRow(state: BattleState, use: ItemUse): PairPreview['heals'] {
  const target = state.pairs.find((row) => row.id === use.targetPairId);
  if (!target) return [];
  return [
    {
      targetPairId: target.id,
      targetLabel: target.label,
      amount: use.healAmount,
      sourceLabel: use.itemName,
    },
  ];
}

function signed(ratio: number): string {
  const value = Math.round(ratio * 100);
  return value >= 0 ? `+${value}%` : `${value}%`;
}


/* ── 적 행동 (패턴) ────────────────────────────────────── */

function previewEnemies(
  state: BattleState,
  pairPreviews: PairPreview[],
  mergedEnemyStatuses: Map<string, StatusEffect[]>,
): EnemyActionPreview[] {
  const livingPairs = state.pairs.filter((pair) => pair.hunter.hp > 0);
  if (livingPairs.length === 0) return [];

  return state.enemies
    .filter((enemy) => enemy.hp > 0)
    .map((enemy, enemyIndex) => {
      const enemyStatuses = mergedEnemyStatuses.get(enemy.id) ?? enemy.statuses;
      const enemyMods = aggregateModifiers(enemyStatuses);
      const pattern = selectPattern(enemy, state.round);
      const patternLabel = pattern?.label ?? enemy.nextPattern;

      const base: EnemyActionPreview = {
        enemyId: enemy.id,
        enemyName: enemy.name,
        pattern: patternLabel,
        patternId: pattern?.id ?? null,
        aoe: pattern?.shape === 'AOE',
        hits: [],
        targetPairId: null,
        damageToHunter: 0,
        appliedStatuses: [],
        blocked: false,
        telegraph: null,
        notes: [],
      };

      if (enemyMods.blockAction) {
        return { ...base, blocked: true, notes: ['행동 불가 상태 — 패턴 취소'] };
      }

      // 예고 패턴 — 이번 라운드에는 공격하지 않고 다음을 알린다
      if (pattern?.shape === 'TELEGRAPH') {
        return {
          ...base,
          telegraph: {
            patternId: pattern.id,
            label: pattern.label,
            message: pattern.telegraphMessage ?? '',
            roundsLeft: pattern.telegraphRounds ?? 1,
          },
          notes: [pattern.telegraphMessage ?? pattern.description],
        };
      }

      // 자기 강화 패턴
      if (pattern?.shape === 'BUFF') {
        return {
          ...base,
          appliedStatuses: pattern.selfStatusIds.map((defId) => ({
            holder: 'ENEMY' as const,
            ownerId: enemy.id,
            defId,
            label: findStatus(defId)?.label ?? defId,
            scale: 1,
          })),
          notes: [pattern.description],
        };
      }

      const targets =
        pattern?.shape === 'AOE'
          ? livingPairs
          : [livingPairs[(state.round - 1 + enemyIndex) % livingPairs.length]];

      const hits = targets.map((target) => {
        const preview = pairPreviews.find((row) => row.pairId === target.id);
        const result = enemyAttackDamage({
          enemy: { ...enemy, attack: Math.round(enemy.attack * (pattern?.powerRatio ?? 1)) },
          hunter: target.hunter,
          damageReduction: preview?.damageReduction ?? 0,
          hunterModifiers: aggregateModifiers(target.hunter.statuses),
          enemyModifiers: enemyMods,
        });
        return { pairId: target.id, pairLabel: target.label, damage: result.amount, notes: result.notes };
      });

      const appliedStatuses: StatusApplication[] = [];
      for (const defId of pattern?.applyStatusIds ?? []) {
        const def = findStatus(defId);
        if (!def) continue;
        for (const hit of hits) {
          // 헌터의 의지가 적이 건 디버프의 지속시간을 깎는다. 버프는 깎지 않는다.
          const target = livingPairs.find((row) => row.id === hit.pairId);
          const resist =
            target && def.kind !== 'BUFF' ? -statusResistRounds(target.hunter) : 0;
          appliedStatuses.push({
            holder: 'HUNTER',
            ownerId: hit.pairId,
            defId,
            label: def.label,
            scale: 1,
            durationBonus: resist,
          });
        }
      }

      return {
        ...base,
        hits: hits.map(({ pairId, pairLabel, damage }) => ({ pairId, pairLabel, damage })),
        targetPairId: pattern?.shape === 'AOE' ? null : hits[0]?.pairId ?? null,
        damageToHunter: hits.reduce((sum, hit) => sum + hit.damage, 0),
        appliedStatuses,
        notes: [
          pattern ? `${pattern.label} — ${pattern.labelKo}` : '단일 공격',
          pattern?.shape === 'AOE' ? `광역 · 대상 ${hits.length}페어` : `대상 ${hits[0]?.pairLabel}`,
          ...(hits[0]?.notes ?? []),
        ],
      };
    });
}

function mergeEnemyStatuses(
  state: BattleState,
  pairPreviews: PairPreview[],
): Map<string, StatusEffect[]> {
  const merged = new Map<string, StatusEffect[]>();
  for (const enemy of state.enemies) {
    merged.set(enemy.id, enemy.statuses);
  }

  for (const row of pairPreviews) {
    for (const application of row.appliedStatuses) {
      if (application.holder !== 'ENEMY') continue;
      const current = merged.get(application.ownerId);
      if (!current) continue;
      merged.set(
        application.ownerId,
        applyStatus(
          current,
          application.defId,
          row.pairLabel,
          application.scale,
          application.durationBonus ?? 0,
        ),
      );
    }
  }

  return merged;
}

function previewStatusTicks(
  state: BattleState,
  pairPreviews: PairPreview[],
  mergedEnemyStatuses: Map<string, StatusEffect[]>,
): StatusTick[] {
  const ticks: StatusTick[] = [];

  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    const statuses = mergedEnemyStatuses.get(enemy.id) ?? enemy.statuses;
    for (const effect of statuses) {
      const def = findStatus(effect.defId);
      if (!def?.modifiers.dotDamage) continue;
      ticks.push({
        holder: 'ENEMY',
        ownerId: enemy.id,
        ownerLabel: enemy.name,
        defId: def.id,
        label: def.label,
        amount: dotAmount(def.modifiers.dotDamage, effect),
      });
    }
  }

  for (const pair of state.pairs) {
    if (pair.hunter.hp <= 0) continue;
    const applied = pairPreviews.find((row) => row.pairId === pair.id);
    let statuses = pair.hunter.statuses;
    for (const application of applied?.appliedStatuses ?? []) {
      if (application.holder === 'HUNTER' && application.ownerId === pair.id) {
        statuses = applyStatus(
          statuses,
          application.defId,
          pair.label,
          application.scale,
          application.durationBonus ?? 0,
        );
      }
    }

    for (const effect of statuses) {
      const def = findStatus(effect.defId);
      if (!def?.modifiers.dotDamage) continue;
      ticks.push({
        holder: 'HUNTER',
        ownerId: pair.id,
        ownerLabel: `${pair.label} ${pair.hunter.name}`,
        defId: def.id,
        label: def.label,
        amount: dotAmount(def.modifiers.dotDamage, effect),
      });
    }
  }

  return ticks;
}

function dotAmount(base: number, effect: StatusEffect): number {
  return Math.max(1, Math.round(base * Math.max(1, effect.stacks) * (effect.scale ?? 1)));
}

/* ── 미리보기 ──────────────────────────────────────────── */

export function previewRound(state: BattleState): RoundPreview {
  const pairPreviews = state.pairs.map((pair) => previewPair(state, pair));
  const mergedEnemyStatuses = mergeEnemyStatuses(state, pairPreviews);
  const enemyPreviews = previewEnemies(state, pairPreviews, mergedEnemyStatuses);
  const statusTicks = previewStatusTicks(state, pairPreviews, mergedEnemyStatuses);

  // 예지 권역의 계시는 공략조 전체가 함께 본다
  const sharedReveal = state.pairs.some(
    (pair) =>
      revelationShared(pair.constellation) &&
      pairPreviews.find((row) => row.pairId === pair.id)?.revealPattern === true,
  );

  // 기믹 진행 예상
  let gimmick: RoundPreview['gimmick'] = null;
  if (state.gimmick && state.gimmick.status === 'ACTIVE') {
    const progress =
      state.gimmick.progress + pairPreviews.reduce((sum, row) => sum + row.gimmickProgress, 0);
    const willClear = progress >= state.gimmick.required;
    const roundsLeft = state.gimmick.roundsLeft;
    gimmick = {
      progress,
      required: state.gimmick.required,
      willClear,
      willFail: !willClear && roundsLeft !== null && roundsLeft - 1 <= 0,
    };
  }

  const alerts: RoundPreview['alerts'] = [];
  for (const row of enemyPreviews) {
    if (row.telegraph) {
      alerts.push({
        level: 'TOWER',
        title: 'TOWER ALERT',
        message: `${row.enemyName} — ${row.telegraph.message}`,
      });
    }
  }
  if (gimmick?.willFail) {
    alerts.push({
      level: 'EMERGENCY',
      title: 'GIMMICK FAILURE',
      message: `${state.gimmick?.label} 해제 실패가 임박했습니다.`,
    });
  }

  return {
    round: state.round,
    pairs: pairPreviews,
    enemies: enemyPreviews,
    statusTicks,
    gimmick,
    sharedReveal,
    alerts,
    totals: {
      damageToEnemies:
        pairPreviews.reduce((sum, row) => sum + row.damageToEnemy + row.itemDamageToEnemy, 0) +
        statusTicks.filter((tick) => tick.holder === 'ENEMY').reduce((sum, t) => sum + t.amount, 0),
      damageToHunters:
        enemyPreviews.reduce((sum, row) => sum + row.damageToHunter, 0) +
        statusTicks.filter((tick) => tick.holder === 'HUNTER').reduce((sum, t) => sum + t.amount, 0),
    },
  };
}

/* ── 적용 ──────────────────────────────────────────────── */

interface StrikeResult {
  hp: number;
  lastStandUsed: boolean;
  /** 전투 불능 저항으로 버텨냈는지 */
  heldOn: boolean;
}

/**
 * 헌터에게 피해를 넣는다.
 *
 * 쓰러지는 순간 의지(WIL)가 남아 있으면 전투당 한 번 버틴다.
 * 굴림이 아니라 조건 판정이므로 예상 결과와 실제 결과가 어긋나지 않는다.
 */
function strikeHunter(hunter: HunterState, damage: number): StrikeResult {
  const raw = hunter.hp - damage;
  if (raw > 0) return { hp: raw, lastStandUsed: hunter.lastStandUsed, heldOn: false };
  if (canLastStand(hunter)) {
    return { hp: LAST_STAND_RULES.survivingHp, lastStandUsed: true, heldOn: true };
  }
  return { hp: 0, lastStandUsed: hunter.lastStandUsed, heldOn: false };
}

export function applyRound(state: BattleState, preview: RoundPreview): BattleState {
  const now = new Date();
  const entries: LogEntry[] = [];
  const alerts: BattleAlert[] = [];
  let alertSeq = 0;

  const log = (text: string, detail?: string, pairId: string | null = null) => {
    entries.push(createLogEntry({ round: preview.round, text, detail, pairId }, now));
  };
  const alert = (level: AlertLevel, title: string, message: string) => {
    alertSeq += 1;
    alerts.push({
      id: `${now.getTime()}-${alertSeq}`,
      level,
      title,
      message,
      round: preview.round,
    });
    log(`${level} — ${title}`, message);
  };

  // 이번 라운드에 지급되는 포인트. 원장에 남겨야 근거가 사라지지 않는다.
  const grants: RewardGrant[] = [];

  log(`ROUND ${String(preview.round).padStart(2, '0')} PROCESSING`);

  // 연출 로그 — 처리 전 상태를 기준으로 만들고, 운영진이 이후 수정한다
  entries.push(
    createLogEntry(
      {
        round: preview.round,
        channel: 'ROLEPLAY',
        text: buildRoleplayText(state, preview),
      },
      now,
    ),
  );

  /* 1) 페어 행동 — 행동력 · 스킬 · 현신 · 상태이상 */
  const pairs = state.pairs.map((pair) => {
    const row = preview.pairs.find((candidate) => candidate.pairId === pair.id);
    if (!row) return pair;

    if (row.hunterActionId) {
      log(
        `${pair.label} HUNTER ACTION — ${row.hunterActionLabel}`,
        `AP -${row.apSpent.hunter}${row.autoFilled.includes('HUNTER') ? ' · AUTO' : ''}`,
        pair.id,
      );
    } else if (row.skipped) {
      log(`${pair.label} HUNTER — ${row.skipReason ?? 'SKIPPED'}`, undefined, pair.id);
    }
    if (row.constellationActionId) {
      log(
        `${pair.label} CONSTELLATION AUTHORITY — ${row.constellationActionLabel}`,
        `AP -${row.apSpent.constellation}${
          row.autoFilled.includes('CONSTELLATION') ? ' · AUTO' : ''
        }`,
        pair.id,
      );
    }
    if (row.autoFilled.length > 0) {
      log(`${pair.label} AUTO CONTROL ENGAGED`, row.autoFilled.join(' / '), pair.id);
    }
    if (row.gimmickNote) {
      log(
        `${pair.label} GIMMICK ${row.gimmickCheck?.stage === 'INSIGHT' ? 'INSIGHT' : 'RESOLVE'}`,
        row.gimmickCheck
          ? `${row.gimmickNote} / 판정 ${row.gimmickCheck.total} vs ${row.gimmickCheck.dc}`
          : row.gimmickNote,
        pair.id,
      );
    }
    if (row.combo) {
      log(
        `${pair.label} PAIR COMBINATION — ${row.combo.label}`,
        `${row.combo.labelKo} · ${row.combo.effects.join(' / ')}`,
        pair.id,
      );
    }

    // 커스텀 스킬 쿨타임 · 사용 횟수
    let hunterSkills = pair.hunter.skills;
    let constellationSkills = pair.constellation.skills;
    for (const used of row.usedSkills) {
      if (used.side === 'HUNTER') {
        hunterSkills = consumeSkill(hunterSkills, used.skillId);
      } else {
        constellationSkills = consumeSkill(constellationSkills, used.skillId);
      }
      const skill =
        used.side === 'HUNTER'
          ? hunterSkills.find((candidate) => candidate.id === used.skillId)
          : constellationSkills.find((candidate) => candidate.id === used.skillId);
      if (skill) {
        log(
          `${pair.label} SKILL USED — ${skill.name}`,
          [
            skill.cooldown > 0 ? `쿨타임 ${skill.cooldown}R` : null,
            skill.remainingUses !== null ? `남은 사용 ${skill.remainingUses}회` : null,
          ]
            .filter(Boolean)
            .join(' · ') || undefined,
          pair.id,
        );
      }
    }

    // 현신 사용 횟수
    let manifestUses = pair.constellation.manifestUses;
    if (row.constellationActionId === 'const.manifest' && manifestUses.partial !== null) {
      manifestUses = { ...manifestUses, partial: Math.max(0, manifestUses.partial - 1) };
      alert('EMERGENCY', 'MANIFESTATION DETECTED', `${pair.constellation.name} 부분 현신`);
    }
    if (row.constellationActionId === 'const.manifest.full' && manifestUses.full !== null) {
      manifestUses = { ...manifestUses, full: Math.max(0, manifestUses.full - 1) };
      alert('EMERGENCY', 'FULL MANIFESTATION DETECTED', `${pair.constellation.name} 완전 현신`);
    }

    // 아이템 — 개수 차감, 행동력 회복, 상태이상 해제.
    // 가방은 사람마다 따로다 — 쓴 사람의 가방에서만 빠진다.
    let hunterBag = pair.hunter.inventory;
    let constellationBag = pair.constellation.inventory;
    let hunterStatuses = pair.hunter.statuses;
    let constellationStatuses = pair.constellation.statuses;
    let hunterApBack = 0;
    let constellationApBack = 0;

    for (const use of row.itemUses) {
      if (use.side === 'HUNTER') hunterBag = consumeItem(hunterBag, use.itemId);
      else constellationBag = consumeItem(constellationBag, use.itemId);

      const left = quantityOf(use.side === 'HUNTER' ? hunterBag : constellationBag, use.itemId);
      log(
        `${pair.label} ${use.side} ITEM USED — ${use.itemName}`,
        [`AP -${use.apCost}`, ...use.effects.slice(1), `남은 개수 ${left}`].join(' · '),
        pair.id,
      );

      if (use.side === 'HUNTER') {
        hunterApBack += use.restoreAp;
        hunterStatuses = removeStatuses(hunterStatuses, use.cureStatusIds);
      } else {
        constellationApBack += use.restoreAp;
        constellationStatuses = removeStatuses(constellationStatuses, use.cureStatusIds);
      }
      for (const defId of use.cureStatusIds) {
        log(`${pair.label} STATUS CLEARED — ${defId}`, use.itemName, pair.id);
      }
    }

    // 자기 페어에게 걸리는 상태이상
    for (const application of row.appliedStatuses) {
      if (application.holder === 'HUNTER' && application.ownerId === pair.id) {
        hunterStatuses = applyStatus(
          hunterStatuses,
          application.defId,
          row.pairLabel,
          application.scale,
          application.durationBonus ?? 0,
        );
        log(`${pair.label} STATUS APPLIED — ${application.label}`, 'HUNTER', pair.id);
      } else if (application.holder === 'CONSTELLATION') {
        constellationStatuses = applyStatus(
          constellationStatuses,
          application.defId,
          row.pairLabel,
          application.scale,
        );
        log(`${pair.label} STATUS APPLIED — ${application.label}`, 'CONSTELLATION', pair.id);
      }
    }

    // 계약 안정도 — 공명 회복과 현신 반동이 여기서 정산된다
    const contract = contractFromValue(pair.contract.value + row.contractDelta);
    if (row.contractDelta !== 0) {
      log(
        `${pair.label} CONTRACT ${pair.contract.value} > ${contract.value}`,
        `${row.contractDelta > 0 ? '+' : ''}${row.contractDelta} · ${contract.stage}`,
        pair.id,
      );
    }
    if (contract.stage !== pair.contract.stage) {
      alert(
        contract.value < pair.contract.value ? 'CRITICAL' : 'WARNING',
        'CONTRACT SHIFT',
        `${pair.label} 계약 상태 ${pair.contract.stage} → ${contract.stage}`,
      );
    }

    // 성좌 존재 상태 — 계약 붕괴로 내려가고, 성유물로 되돌아온다
    const stage = row.stageDrop === 0 ? pair.constellation.stage : shiftStage(pair.constellation.stage, row.stageDrop);
    if (stage !== pair.constellation.stage) {
      alert(
        row.stageDrop > 0 ? 'CRITICAL' : 'WARNING',
        row.stageDrop > 0 ? 'CONSTELLATION DESTABILIZED' : 'CONSTELLATION STABILIZED',
        `${pair.constellation.name} ${pair.constellation.stage} → ${stage}`,
      );
    }

    return {
      ...pair,
      contract,
      hunter: {
        ...pair.hunter,
        ap: Math.min(
          pair.hunter.maxAp,
          Math.max(0, pair.hunter.ap - row.apSpent.hunter) + hunterApBack,
        ),
        skills: hunterSkills,
        statuses: hunterStatuses,
        inventory: hunterBag,
      },
      constellation: {
        ...pair.constellation,
        stage,
        inventory: constellationBag,
        ap: Math.min(
          constellationMaxAp(pair.constellation.maxAp, stage),
          Math.max(0, pair.constellation.ap - row.apSpent.constellation) + constellationApBack,
        ),
        skills: constellationSkills,
        statuses: constellationStatuses,
        manifestUses,
      },
      // 예지 권역의 계시는 공략조 전체가 함께 본다
      patternRevealed: row.revealPattern || preview.sharedReveal,
    };
  });

  /* 다른 페어에게 걸리는 상태이상 (보호) */
  for (const row of preview.pairs) {
    for (const application of row.appliedStatuses) {
      if (application.holder !== 'HUNTER' || application.ownerId === row.pairId) continue;
      const index = pairs.findIndex((pair) => pair.id === application.ownerId);
      if (index < 0) continue;
      pairs[index] = {
        ...pairs[index],
        hunter: {
          ...pairs[index].hunter,
          statuses: applyStatus(
            pairs[index].hunter.statuses,
            application.defId,
            row.pairLabel,
            application.scale,
            application.durationBonus ?? 0,
          ),
        },
      };
      log(
        `${pairs[index].label} STATUS APPLIED — ${application.label}`,
        `${row.pairLabel} 보호`,
        pairs[index].id,
      );
    }
  }

  /* 2) 구조 */
  for (const row of preview.pairs) {
    if (!row.rescue) continue;
    const index = pairs.findIndex((pair) => pair.id === row.rescue?.targetPairId);
    if (index < 0 || pairs[index].hunter.hp > 0) continue;

    let statuses = pairs[index].hunter.statuses;
    for (const defId of RESCUE_RULES.applyStatusIds) {
      statuses = applyStatus(statuses, defId, row.pairLabel);
    }
    pairs[index] = {
      ...pairs[index],
      hunter: { ...pairs[index].hunter, hp: row.rescue.restoredHp, statuses },
    };
    alert(
      'WARNING',
      'HUNTER RECOVERED',
      `${row.pairLabel} → ${row.rescue.targetLabel} 구조 완료 (HP ${row.rescue.restoredHp})`,
    );
  }

  /* 2-1) 페어가 이번 라운드에 확보한 포인트 (구조 등) */
  for (const row of preview.pairs) {
    for (const reward of row.rewards) {
      grants.push({ pairId: row.pairId, reason: reward.reason, label: reward.label, points: reward.points });
    }
  }

  /* 2-2) 회복 — 회복 스킬과 아이템은 구조와 별도로 정산한다 */
  for (const row of preview.pairs) {
    for (const heal of row.heals) {
      const index = pairs.findIndex((pair) => pair.id === heal.targetPairId);
      if (index < 0) continue;

      const target = pairs[index];
      const reviving = row.itemUses.some((use) => use.revive && use.targetPairId === target.id);

      // 전투 불능인 대상은 부활 효과가 있는 아이템만 되살릴 수 있다.
      if (target.hunter.hp <= 0 && !reviving) {
        log(`${target.label} HEAL FAILED — 전투 불능`, heal.sourceLabel, target.id);
        continue;
      }

      const hp = Math.min(target.hunter.maxHp, Math.max(0, target.hunter.hp) + heal.amount);
      log(
        `${target.label} HEAL ${target.hunter.hp} > ${hp}`,
        `${heal.sourceLabel} · +${heal.amount}`,
        target.id,
      );
      pairs[index] = { ...target, hunter: { ...target.hunter, hp } };

      if (reviving) {
        alert('WARNING', 'HUNTER RECOVERED', `${row.pairLabel} → ${target.label} 아이템으로 복귀`);
      }
    }
  }

  /* 3) 적 상태이상 + 피해 */
  const damageByEnemy = new Map<string, number>();
  for (const row of preview.pairs) {
    if (!row.targetEnemyId) continue;
    const total = row.damageToEnemy + row.itemDamageToEnemy;
    if (total <= 0) continue;
    damageByEnemy.set(row.targetEnemyId, (damageByEnemy.get(row.targetEnemyId) ?? 0) + total);
    log(`${row.pairLabel} DAMAGE ${total}`, row.notes.join(' / '), row.pairId);
  }

  let enemies = state.enemies.map((enemy) => {
    let statuses = enemy.statuses;
    for (const row of preview.pairs) {
      for (const application of row.appliedStatuses) {
        if (application.holder !== 'ENEMY' || application.ownerId !== enemy.id) continue;
        statuses = applyStatus(statuses, application.defId, row.pairLabel, application.scale);
        log(`TARGET STATUS APPLIED — ${application.label}`, `${enemy.name} ← ${row.pairLabel}`);
      }
    }
    for (const row of preview.enemies) {
      if (row.enemyId !== enemy.id) continue;
      for (const application of row.appliedStatuses) {
        if (application.holder !== 'ENEMY') continue;
        statuses = applyStatus(statuses, application.defId, enemy.name, application.scale);
        log(`TARGET STATUS APPLIED — ${application.label}`, `${enemy.name} 자기 강화`);
      }
    }

    const damage = damageByEnemy.get(enemy.id) ?? 0;
    const hp = Math.max(0, enemy.hp - damage);
    if (damage > 0) {
      log(`TARGET ${enemy.name} HP ${enemy.hp} > ${hp}`, `TOTAL DAMAGE ${damage}`);
      if (hp === 0) log(`TARGET DOWN — ${enemy.name}`);
    }

    return { ...enemy, hp, statuses };
  });

  /* 4) 적 행동 */
  for (const row of preview.enemies) {
    const enemyStillAlive = enemies.find((enemy) => enemy.id === row.enemyId);
    if (enemyStillAlive && enemyStillAlive.hp === 0) {
      if (row.damageToHunter > 0 || row.telegraph) {
        log(`${row.enemyName} ACTION CANCELLED`, '처치로 행동 취소');
      }
      continue;
    }

    if (row.blocked) {
      log(`${row.enemyName} ACTION BLOCKED`, row.notes.join(' / '));
      continue;
    }

    if (row.telegraph) {
      const index = enemies.findIndex((enemy) => enemy.id === row.enemyId);
      if (index >= 0) {
        enemies[index] = { ...enemies[index], telegraph: row.telegraph };
      }
      alert('TOWER', 'TOWER ALERT', `${row.enemyName} — ${row.telegraph.message}`);
      continue;
    }

    if (row.aoe && row.hits.length > 0) {
      alert('WARNING', 'AREA ATTACK', `${row.enemyName} — ${row.pattern}`);
    }

    for (const hit of row.hits) {
      const index = pairs.findIndex((pair) => pair.id === hit.pairId);
      if (index < 0 || hit.damage <= 0) continue;

      const target = pairs[index];
      if (target.hunter.hp <= 0) continue;

      const strike = strikeHunter(target.hunter, hit.damage);
      log(
        `${row.enemyName} → ${target.label} DAMAGE ${hit.damage}`,
        `${row.pattern} / ${row.notes.join(' / ')}`,
        target.id,
      );
      log(`${target.label} HUNTER HP ${target.hunter.hp} > ${strike.hp}`, undefined, target.id);

      let statuses = target.hunter.statuses;
      for (const application of row.appliedStatuses) {
        if (application.holder !== 'HUNTER' || application.ownerId !== target.id) continue;
        statuses = applyStatus(
          statuses,
          application.defId,
          row.enemyName,
          application.scale,
          application.durationBonus ?? 0,
        );
        log(`${target.label} STATUS APPLIED — ${application.label}`, row.enemyName, target.id);
      }

      pairs[index] = {
        ...target,
        hunter: { ...target.hunter, hp: strike.hp, statuses, lastStandUsed: strike.lastStandUsed },
      };

      if (strike.heldOn) {
        alert(
          'CRITICAL',
          'HUNTER HELD ON',
          `${target.label} ${target.hunter.name} 의지로 버텨냈습니다 (HP ${strike.hp})`,
        );
      } else if (strike.hp === 0) {
        alert('CRITICAL', 'HUNTER DOWN', `${target.label} ${target.hunter.name} 전투 불능`);
      } else {
        const injury = injuryOf(pairs[index].hunter);
        log(`${target.label} STATUS ${injury.label}`, injury.labelKo, target.id);
      }
    }

    // 예고가 해소되었으면 비운다
    const index = enemies.findIndex((enemy) => enemy.id === row.enemyId);
    if (index >= 0 && enemies[index].telegraph && enemies[index].telegraph!.roundsLeft <= 0) {
      enemies[index] = { ...enemies[index], telegraph: null };
    }
  }

  /* 5) 지속 피해 */
  for (const tick of preview.statusTicks) {
    if (tick.holder === 'ENEMY') {
      const index = enemies.findIndex((enemy) => enemy.id === tick.ownerId);
      if (index < 0 || enemies[index].hp <= 0) continue;
      const hp = Math.max(0, enemies[index].hp - tick.amount);
      log(`${tick.label} TICK — ${tick.ownerLabel} ${enemies[index].hp} > ${hp}`, `-${tick.amount}`);
      enemies[index] = { ...enemies[index], hp };
      if (hp === 0) log(`TARGET DOWN — ${enemies[index].name}`);
      continue;
    }

    const index = pairs.findIndex((pair) => pair.id === tick.ownerId);
    if (index < 0 || pairs[index].hunter.hp <= 0) continue;
    const strike = strikeHunter(pairs[index].hunter, tick.amount);
    log(
      `${tick.label} TICK — ${tick.ownerLabel} ${pairs[index].hunter.hp} > ${strike.hp}`,
      `-${tick.amount}`,
      pairs[index].id,
    );
    pairs[index] = {
      ...pairs[index],
      hunter: { ...pairs[index].hunter, hp: strike.hp, lastStandUsed: strike.lastStandUsed },
    };
    if (strike.heldOn) {
      alert('CRITICAL', 'HUNTER HELD ON', `${pairs[index].label} 지속 피해를 의지로 버텨냈습니다`);
    } else if (strike.hp === 0) {
      alert('CRITICAL', 'HUNTER DOWN', `${pairs[index].label} 지속 피해로 전투 불능`);
    }
  }

  /* 6) 기믹 정산 */
  let gimmick: GimmickState | null = state.gimmick;

  // 파악에 성공한 페어가 있으면 장치 정보가 공략조 전체에 공유된다
  if (gimmick && gimmick.status === 'ACTIVE') {
    const identifiers = preview.pairs.filter((row) => row.gimmickIdentified);
    if (identifiers.length > 0 && !gimmick.identified) {
      gimmick = {
        ...gimmick,
        identified: true,
        identifiedBy: [...gimmick.identifiedBy, ...identifiers.map((row) => row.pairLabel)],
      };
      alert(
        'WARNING',
        'GIMMICK IDENTIFIED',
        `${identifiers.map((row) => row.pairLabel).join(', ')} — ${findGimmick(gimmick.defId)?.insightReveal ?? '장치를 파악했습니다.'}`,
      );
    } else if (identifiers.length > 0) {
      for (const row of identifiers) {
        log(`GIMMICK INSIGHT — ${row.pairLabel} (이미 파악됨)`, undefined, row.pairId);
      }
    }
  }

  if (gimmick && gimmick.status === 'ACTIVE') {
    const gained = preview.pairs.reduce((sum, row) => sum + row.gimmickProgress, 0);
    const progress = gimmick.progress + gained;
    const roundsLeft = gimmick.roundsLeft === null ? null : gimmick.roundsLeft - 1;
    const def = findGimmick(gimmick.defId);

    if (gained > 0) {
      log(`GIMMICK PROGRESS — ${gimmick.label} ${progress}/${gimmick.required}`, `+${gained}`);
    }

    if (progress >= gimmick.required) {
      gimmick = { ...gimmick, progress, roundsLeft, status: 'CLEARED' };
      alert('WARNING', 'GIMMICK CLEARED', def?.onClear.message ?? `${gimmick.label} 해제`);

      // 장치를 실제로 다룬 페어에게 지급한다. 아무도 없으면(운영진 처리) 생존 페어에게 나눈다.
      const contributors = preview.pairs.filter((row) => row.gimmickProgress > 0);
      const receivers =
        contributors.length > 0
          ? contributors.map((row) => row.pairId)
          : pairs.filter((pair) => pair.hunter.hp > 0).map((pair) => pair.id);
      for (const pairId of receivers) {
        grants.push(grantFor(pairId, 'HIDDEN_GIMMICK'));
      }

      // 장치 해제는 계약에도 좋게 작용한다
      for (let index = 0; index < pairs.length; index += 1) {
        if (!receivers.includes(pairs[index].id)) continue;
        pairs[index] = {
          ...pairs[index],
          contract: contractFromValue(
            pairs[index].contract.value + CONTRACT_RULES.events.gimmickCleared,
          ),
        };
      }

      if (def) {
        enemies = enemies.map((enemy) => {
          if (!enemy.boss || enemy.hp <= 0) return enemy;
          let statuses = enemy.statuses;
          for (const defId of def.onClear.applyStatusIds ?? []) {
            statuses = applyStatus(statuses, defId, gimmick!.label);
          }
          const hp = Math.max(0, enemy.hp - (def.onClear.damage ?? 0));
          if (def.onClear.damage) {
            log(`GIMMICK DAMAGE — ${enemy.name} ${enemy.hp} > ${hp}`, `-${def.onClear.damage}`);
          }
          // 예고 중인 즉사급 패턴은 기믹 해제로 무력화된다
          return { ...enemy, hp, statuses, telegraph: null };
        });
      }
    } else if (roundsLeft !== null && roundsLeft <= 0) {
      gimmick = { ...gimmick, progress, roundsLeft: 0, status: 'FAILED' };
      alert('EMERGENCY', 'GIMMICK FAILED', def?.onFail.message ?? `${gimmick.label} 해제 실패`);

      if (def?.onFail.damageToAll) {
        for (let index = 0; index < pairs.length; index += 1) {
          if (pairs[index].hunter.hp <= 0) continue;
          const strike = strikeHunter(pairs[index].hunter, def.onFail.damageToAll);
          let statuses = pairs[index].hunter.statuses;
          const resist = statusResistRounds(pairs[index].hunter);
          for (const defId of def.onFail.applyStatusIds ?? []) {
            statuses = applyStatus(statuses, defId, gimmick.label, 1, -resist);
          }
          log(
            `GIMMICK BACKLASH — ${pairs[index].label} ${pairs[index].hunter.hp} > ${strike.hp}`,
            `-${def.onFail.damageToAll}`,
            pairs[index].id,
          );
          pairs[index] = {
            ...pairs[index],
            hunter: {
              ...pairs[index].hunter,
              hp: strike.hp,
              statuses,
              lastStandUsed: strike.lastStandUsed,
            },
          };
        }
      }
    } else {
      gimmick = { ...gimmick, progress, roundsLeft };
    }
  }

  /* 7) 보스 페이즈 판정 */
  enemies = enemies.map((enemy) => {
    if (!enemy.boss || enemy.hp <= 0) return enemy;
    const phase = evaluatePhase(enemy);
    if (!phase.changed) return enemy;
    alert('WARNING', 'BOSS PHASE CHANGE', `${enemy.name} — ${phase.label}`);
    return { ...enemy, phase: phase.phase };
  });

  /* 8) 종료 판정 */
  const allEnemiesDown = enemies.every((enemy) => enemy.hp === 0);
  const allHuntersDown = pairs.every((pair) => pair.hunter.hp === 0);

  /**
   * 포인트 정산.
   * 원장에 항목을 남기고 페어 보유량에 더한다 — 두 곳이 어긋나면 근거를 잃는다.
   */
  const settleRewards = (targetPairs: PairState[]): { pairs: PairState[]; rewards: RewardEntry[] } => {
    if (grants.length === 0) return { pairs: targetPairs, rewards: state.rewards };
    for (const grant of grants) {
      const label = targetPairs.find((pair) => pair.id === grant.pairId)?.label ?? grant.pairId;
      log(`${label} POINTS +${grant.points}`, grant.label, grant.pairId);
    }
    return {
      pairs: applyGrants(targetPairs, grants),
      rewards: [...state.rewards, ...toEntries(grants, preview.round, now.getTime())],
    };
  };

  if (allEnemiesDown || allHuntersDown) {
    log(allEnemiesDown ? 'OPERATION CLEARED' : 'OPERATION FAILED — ALL HUNTERS DOWN');
    const status = allEnemiesDown ? 'CLEARED' : 'FAILED';

    // 클리어 보상은 종료가 확정된 다음에만 지급한다
    grants.push(...clearRewards({ ...state, pairs, enemies, status }));

    const settled = settleRewards(pairs);
    return {
      ...state,
      pairs: settled.pairs,
      rewards: settled.rewards,
      enemies,
      gimmick,
      status,
      log: appendLog(state.log, entries),
      alerts: [...state.alerts, ...alerts].slice(-12),
    };
  }

  /* 9) 라운드 종료 — 상태이상 · 쿨타임 · 예고 · 행동력 */
  const nextRound = state.round + 1;

  enemies = enemies.map((enemy) => {
    const ticked = tickStatuses(enemy.statuses);
    for (const expired of ticked.expired) {
      log(`STATUS EXPIRED — ${expired.label}`, enemy.name);
    }
    const telegraph = enemy.telegraph
      ? { ...enemy.telegraph, roundsLeft: enemy.telegraph.roundsLeft - 1 }
      : null;
    const next = { ...enemy, statuses: ticked.statuses, telegraph };
    return { ...next, nextPattern: nextPatternLabel(next, nextRound) };
  });

  const recovered = pairs.map((pair) => {
    const hunterTicked = tickStatuses(pair.hunter.statuses);
    const constellationTicked = tickStatuses(pair.constellation.statuses);
    for (const expired of [...hunterTicked.expired, ...constellationTicked.expired]) {
      log(`STATUS EXPIRED — ${expired.label}`, pair.label, pair.id);
    }

    const constMax = constellationMaxAp(pair.constellation.maxAp, pair.constellation.stage);
    return {
      ...pair,
      hunter: {
        ...pair.hunter,
        ap: Math.min(pair.hunter.maxAp, pair.hunter.ap + AP_RULES.recoveryPerRound),
        statuses: hunterTicked.statuses,
        skills: tickCooldowns(pair.hunter.skills),
      },
      constellation: {
        ...pair.constellation,
        ap: Math.min(constMax, pair.constellation.ap + AP_RULES.recoveryPerRound),
        statuses: constellationTicked.statuses,
        skills: tickCooldowns(pair.constellation.skills),
      },
    };
  });

  log(`ROUND ${String(nextRound).padStart(2, '0')} START`, `AP +${AP_RULES.recoveryPerRound}`);

  const settled = settleRewards(recovered);

  return {
    ...state,
    round: nextRound,
    pairs: clearSubmissions(settled.pairs, enemies),
    rewards: settled.rewards,
    enemies,
    gimmick,
    log: appendLog(state.log, entries),
    alerts: [...state.alerts, ...alerts].slice(-12),
  };
}

/* ── 제출 헬퍼 ─────────────────────────────────────────── */

export function submitPairAction(
  state: BattleState,
  pairId: string,
  patch: {
    hunterActionId?: string | null;
    constellationActionId?: string | null;
    targetEnemyId?: string | null;
    supportTargetPairId?: string | null;
    gimmickNote?: string | null;
    gimmickStage?: GimmickStage | null;
    gimmickCheck?: GimmickCheck | null;
    hunterItemId?: string | null;
    constellationItemId?: string | null;
    hunterSubmitted?: boolean;
    constellationSubmitted?: boolean;
  },
): BattleState {
  return {
    ...state,
    pairs: state.pairs.map((pair) =>
      pair.id === pairId ? { ...pair, submission: { ...pair.submission, ...patch } } : pair,
    ),
  };
}

export function setControlMode(
  state: BattleState,
  pairId: string,
  side: ActorSide,
  control: 'ACTIVE' | 'AUTO',
): BattleState {
  const now = new Date();
  const pair = state.pairs.find((candidate) => candidate.id === pairId);
  const entries = pair
    ? [
        createLogEntry(
          {
            round: state.round,
            text: `${pair.label} ${side} CONTROL — ${control}`,
            detail: control === 'AUTO' ? '자동 행동 위임' : '참가자 조작 복귀',
            pairId,
          },
          now,
        ),
      ]
    : [];

  return {
    ...state,
    log: appendLog(state.log, entries),
    pairs: state.pairs.map((candidate) => {
      if (candidate.id !== pairId) return candidate;
      return side === 'HUNTER'
        ? { ...candidate, hunter: { ...candidate.hunter, control } }
        : { ...candidate, constellation: { ...candidate.constellation, control } };
    }),
  };
}

export function dismissAlert(state: BattleState, alertId: string): BattleState {
  return { ...state, alerts: state.alerts.filter((alert) => alert.id !== alertId) };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type { PatternDefinition };
