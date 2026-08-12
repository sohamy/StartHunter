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
import { findPattern, type PatternDefinition } from '../config/patterns';
import {
  AP_RULES,
  CONSTELLATION_STAGES,
  CURRENT_PHASE,
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
  LogEntry,
  PairPreview,
  PairState,
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
import { appendLog, createLogEntry } from './log';
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
  injuryOf,
  isDown,
  tickStatuses,
} from './status';

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

export function actionAvailability(
  action: ActionDefinition,
  pair: PairState,
  hasTarget: boolean,
): Availability {
  if (action.implementedIn > CURRENT_PHASE) {
    return { usable: false, reason: `PHASE ${action.implementedIn} 구현 예정` };
  }

  const actor = action.side === 'HUNTER' ? pair.hunter : pair.constellation;
  if (action.apCost > actor.ap) {
    return { usable: false, reason: `행동력 부족 (필요 ${action.apCost})` };
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

  if (action.side === 'CONSTELLATION') {
    if (pair.constellation.stage === 'LOST' && action.kind !== 'WAIT') {
      return { usable: false, reason: '성좌 소멸' };
    }
    if (action.kind === 'MANIFEST' || action.kind === 'FULL_MANIFEST') {
      if (!canManifest(pair.constellation.stage)) {
        return { usable: false, reason: '현재 성좌 상태로는 현신 불가' };
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

function resolveActorAction(
  side: ActorSide,
  pair: PairState,
  enemy: EnemyState | null,
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
    const availability = actionAvailability(submitted, pair, Boolean(enemy));
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

function planStatuses(
  pair: PairState,
  enemy: EnemyState | null,
  supportPair: PairState | null,
  actions: Array<{ action: ActionDefinition; scaleBuff: number; scaleDebuff: number }>,
  extraStatusIds: string[],
): StatusPlan {
  const plan: StatusPlan = {
    hunterStatuses: pair.hunter.statuses,
    constellationStatuses: pair.constellation.statuses,
    enemyStatuses: enemy?.statuses ?? [],
    applied: [],
    notes: [],
  };

  const queue: Array<{ defId: string; scaleBuff: number; scaleDebuff: number; label: string; holderOverride?: 'HUNTER'; ownerOverride?: string }> = [];

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
      });
    }
  }

  // 연계로 추가되는 상태이상
  for (const defId of extraStatusIds) {
    queue.push({ defId, scaleBuff: 1, scaleDebuff: 1, label: 'PAIR LINK' });
  }

  for (const item of queue) {
    const def = findStatus(item.defId);
    if (!def) continue;

    const holder = item.holderOverride ?? def.appliesTo;
    const scale = def.kind === 'BUFF' ? item.scaleBuff : item.scaleDebuff;

    if (holder === 'ENEMY') {
      if (!enemy) continue;
      plan.enemyStatuses = applyStatus(plan.enemyStatuses, item.defId, item.label, scale);
      plan.applied.push({ holder, ownerId: enemy.id, defId: item.defId, label: def.label, scale });
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
      `${def.label} 부여 (${def.duration}R${scale !== 1 ? ` · ×${round2(scale)}` : ''})`,
    );
  }

  return plan;
}

/* ── 페어 예상 결과 ────────────────────────────────────── */

function previewPair(state: BattleState, pair: PairState): PairPreview {
  const enemy = resolveTarget(state, pair);
  const notes: string[] = [];

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
    const constellationResolved = resolveActorAction('CONSTELLATION', pair, enemy);
    const stagePenalty = CONSTELLATION_STAGES[pair.constellation.stage];
    const buffScale = round2(pair.constellation.power * stagePenalty.buffPowerMultiplier);
    const debuffScale = round2(pair.constellation.power * stagePenalty.debuffPowerMultiplier);
    const plan = planStatuses(
      pair,
      enemy,
      null,
      [{ action: constellationResolved.action, scaleBuff: buffScale, scaleDebuff: debuffScale }],
      [],
    );
    notes.push(...plan.notes);

    return {
      ...empty,
      constellationActionId: constellationResolved.action.id,
      constellationActionLabel: constellationResolved.action.label,
      autoFilled: constellationResolved.auto ? ['CONSTELLATION'] : [],
      apSpent: { hunter: 0, constellation: constellationResolved.action.apCost },
      appliedStatuses: plan.applied,
      revealPattern: Boolean(constellationResolved.action.effect.revealPattern),
      usedSkills: findSkillRuntime(pair, 'CONSTELLATION', constellationResolved.action.id)
        ? [{ side: 'CONSTELLATION', skillId: constellationResolved.action.id }]
        : [],
      skipped: true,
      skipReason: 'HUNTER DOWN',
    };
  }

  const hunterResolved = resolveActorAction('HUNTER', pair, enemy);
  const constellationResolved = resolveActorAction('CONSTELLATION', pair, enemy);
  const autoFilled: ActorSide[] = [];
  if (hunterResolved.auto) autoFilled.push('HUNTER');
  if (constellationResolved.auto) autoFilled.push('CONSTELLATION');

  if (hunterResolved.reason) notes.push(`HUNTER: ${hunterResolved.reason}`);
  if (constellationResolved.reason) notes.push(`CONSTELLATION: ${constellationResolved.reason}`);

  // 성좌의 권능 배율과 존재 상태 보정
  const stagePenalty = CONSTELLATION_STAGES[pair.constellation.stage];
  const buffScale = round2(pair.constellation.power * stagePenalty.buffPowerMultiplier);
  const debuffScale = round2(pair.constellation.power * stagePenalty.debuffPowerMultiplier);

  // 페어 연계 판정 — 행동 조합과 대상 상태로 결정된다
  const combo = detectCombo({
    hunterAction: hunterResolved.action,
    constellationAction: constellationResolved.action,
    enemyStatuses: enemy?.statuses ?? [],
  });
  if (combo) {
    notes.push(`PAIR LINK ${combo.definition.label} — ${combo.view.effects.join(' / ')}`);
  }

  // 지원 대상 (보호 · 구조)
  const supportPair =
    state.pairs.find((row) => row.id === pair.submission.supportTargetPairId) ?? null;

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
  );
  notes.push(...plan.notes);

  const constellationEffect = constellationResolved.action.effect;
  const hunterEffect = hunterResolved.action.effect;

  const hunterMods = mergeModifiers(aggregateModifiers(plan.hunterStatuses), {
    attackUp: ((constellationEffect.attackUp ?? 0) * buffScale) + (combo?.effect.damageBonus ?? 0),
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
    const result = hunterAttackDamage({
      hunter: pair.hunter,
      enemy,
      powerRatio: constellationEffect.damage,
      hunterModifiers: hunterMods,
      enemyModifiers: enemyMods,
    });
    damageToEnemy += result.amount;
    notes.push(`성좌 개입 피해 ${result.amount}`);
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

  // 3) 구조
  let rescue: PairPreview['rescue'] = null;
  if (hunterResolved.action.kind === 'RESCUE') {
    const target = supportPair ?? state.pairs.find((row) => row.hunter.hp <= 0) ?? null;
    if (target && target.hunter.hp <= 0) {
      const ratio = RESCUE_RULES.revivePercent * (1 + (combo?.effect.rescueBonus ?? 0));
      const restoredHp = Math.max(1, Math.round(target.hunter.maxHp * ratio));
      rescue = { targetPairId: target.id, targetLabel: target.label, restoredHp };
      notes.push(`구조 대상 ${target.label} — HP ${restoredHp} 회복`);
    } else {
      notes.push('구조 대상 없음 — 행동이 소모되지 않습니다');
    }
  }

  // 4) 기믹 — 파악(INSIGHT) → 해결(RESOLVE)
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
    appliedStatuses: plan.applied,
    combo: combo?.view ?? null,
    rescue,
    gimmickProgress,
    gimmickNote,
    gimmickCheck,
    gimmickIdentified,
    autoFilled,
    apSpent: {
      hunter: hunterResolved.action.apCost,
      constellation: constellationResolved.action.apCost,
    },
    damageToEnemy,
    damageReduction,
    revealPattern: Boolean(constellationEffect.revealPattern),
    notes,
  };
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
          appliedStatuses.push({
            holder: 'HUNTER',
            ownerId: hit.pairId,
            defId,
            label: def.label,
            scale: 1,
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
        applyStatus(current, application.defId, row.pairLabel, application.scale),
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
        statuses = applyStatus(statuses, application.defId, pair.label, application.scale);
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
    alerts,
    totals: {
      damageToEnemies:
        pairPreviews.reduce((sum, row) => sum + row.damageToEnemy, 0) +
        statusTicks.filter((tick) => tick.holder === 'ENEMY').reduce((sum, t) => sum + t.amount, 0),
      damageToHunters:
        enemyPreviews.reduce((sum, row) => sum + row.damageToHunter, 0) +
        statusTicks.filter((tick) => tick.holder === 'HUNTER').reduce((sum, t) => sum + t.amount, 0),
    },
  };
}

/* ── 적용 ──────────────────────────────────────────────── */

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

    // 자기 페어에게 걸리는 상태이상
    let hunterStatuses = pair.hunter.statuses;
    let constellationStatuses = pair.constellation.statuses;
    for (const application of row.appliedStatuses) {
      if (application.holder === 'HUNTER' && application.ownerId === pair.id) {
        hunterStatuses = applyStatus(
          hunterStatuses,
          application.defId,
          row.pairLabel,
          application.scale,
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

    return {
      ...pair,
      hunter: {
        ...pair.hunter,
        ap: Math.max(0, pair.hunter.ap - row.apSpent.hunter),
        skills: hunterSkills,
        statuses: hunterStatuses,
      },
      constellation: {
        ...pair.constellation,
        ap: Math.max(0, pair.constellation.ap - row.apSpent.constellation),
        skills: constellationSkills,
        statuses: constellationStatuses,
        manifestUses,
      },
      patternRevealed: row.revealPattern,
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

  /* 3) 적 상태이상 + 피해 */
  const damageByEnemy = new Map<string, number>();
  for (const row of preview.pairs) {
    if (!row.targetEnemyId || row.damageToEnemy <= 0) continue;
    damageByEnemy.set(
      row.targetEnemyId,
      (damageByEnemy.get(row.targetEnemyId) ?? 0) + row.damageToEnemy,
    );
    log(`${row.pairLabel} DAMAGE ${row.damageToEnemy}`, row.notes.join(' / '), row.pairId);
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

      const hp = Math.max(0, target.hunter.hp - hit.damage);
      log(
        `${row.enemyName} → ${target.label} DAMAGE ${hit.damage}`,
        `${row.pattern} / ${row.notes.join(' / ')}`,
        target.id,
      );
      log(`${target.label} HUNTER HP ${target.hunter.hp} > ${hp}`, undefined, target.id);

      let statuses = target.hunter.statuses;
      for (const application of row.appliedStatuses) {
        if (application.holder !== 'HUNTER' || application.ownerId !== target.id) continue;
        statuses = applyStatus(statuses, application.defId, row.enemyName, application.scale);
        log(`${target.label} STATUS APPLIED — ${application.label}`, row.enemyName, target.id);
      }

      pairs[index] = { ...target, hunter: { ...target.hunter, hp, statuses } };

      if (hp === 0) {
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
    const hp = Math.max(0, pairs[index].hunter.hp - tick.amount);
    log(
      `${tick.label} TICK — ${tick.ownerLabel} ${pairs[index].hunter.hp} > ${hp}`,
      `-${tick.amount}`,
      pairs[index].id,
    );
    pairs[index] = { ...pairs[index], hunter: { ...pairs[index].hunter, hp } };
    if (hp === 0) {
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
          const hp = Math.max(0, pairs[index].hunter.hp - def.onFail.damageToAll);
          let statuses = pairs[index].hunter.statuses;
          for (const defId of def.onFail.applyStatusIds ?? []) {
            statuses = applyStatus(statuses, defId, gimmick.label);
          }
          log(
            `GIMMICK BACKLASH — ${pairs[index].label} ${pairs[index].hunter.hp} > ${hp}`,
            `-${def.onFail.damageToAll}`,
            pairs[index].id,
          );
          pairs[index] = { ...pairs[index], hunter: { ...pairs[index].hunter, hp, statuses } };
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

  if (allEnemiesDown || allHuntersDown) {
    log(allEnemiesDown ? 'OPERATION CLEARED' : 'OPERATION FAILED — ALL HUNTERS DOWN');
    return {
      ...state,
      pairs,
      enemies,
      gimmick,
      status: allEnemiesDown ? 'CLEARED' : 'FAILED',
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

  return {
    ...state,
    round: nextRound,
    pairs: clearSubmissions(recovered, enemies),
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
