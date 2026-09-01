/**
 * 페어 한 쌍의 이번 라운드 예상 결과.
 *
 * 헌터와 성좌의 행동, 둘의 연계, 아이템, 회복, 계약 변화까지 한 쌍 단위로 센다.
 * 상태는 바꾸지 않는다 — 숫자만 만들어 돌려준다.
 */

import { CONSTELLATION_STAGES, CONTRACT_RULES, HEAL_RULES, RESCUE_RULES } from '../../config/rules';
import { findStatus } from '../../config/status';
import type {
  ActionDefinition,
  ActorSide,
  BattleState,
  EnemyState,
  ItemUse,
  PairPreview,
  PairState,
  StatusApplication,
} from '../../types';
import { resolveTarget } from '../battle';
import { detectCombo } from '../combo';
import { hunterAttackDamage } from '../damage';
import { declarationValid, progressFrom } from '../gimmick';
import { resolveItem } from '../items';
import { grantFor } from '../rewards';
import { findSkillRuntime } from '../skills';
import { aggregateModifiers, contractPowerMultiplier, isDown } from '../status';
import {
  buffAmplifier,
  contractRecovery,
  healBonus,
  manifestPower,
  protectAmplifier,
  recoilRelief,
  rescueBonus,
  revelationShared,
  statusDurationBonus,
  weakPointBonus,
} from '../traits';
import { resolveActorAction, type ResolvedAction } from './action';
import { apCostOf, submittedItemId } from './availability';
import { mergeModifiers, round2 } from './shared';
import { planStatuses, type StatusTraitContext } from './status';


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

export function previewPair(state: BattleState, pair: PairState): PairPreview {
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


