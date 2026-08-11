/**
 * 라운드 처리.
 *
 * 흐름은 요구사항서 4장을 따른다.
 *   행동 확정 → 버프/디버프 처리 → 헌터·성좌 행동 → (연계: Phase 3)
 *   → 적 행동 → 피해 및 상태이상 정산 → 지속시간·쿨타임 감소
 *
 * previewRound() 는 상태를 바꾸지 않고 예상 결과만 만든다.
 * applyRound() 는 preview 를 받아 실제 상태를 만든다.
 * 이 사이에 운영진 수정 단계(Phase 5)를 끼워 넣을 수 있어야 하므로 둘을 분리해 둔다.
 */

import { AP_RULES, CONSTELLATION_STAGES, CURRENT_PHASE } from '../config/rules';
import { findStatus, type StatusModifiers } from '../config/status';
import type {
  ActionDefinition,
  ActorSide,
  BattleState,
  EnemyActionPreview,
  EnemyState,
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
import { enemyAttackDamage, hunterAttackDamage } from './damage';
import { appendLog, createLogEntry } from './log';
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
    if (
      (action.kind === 'MANIFEST' || action.kind === 'FULL_MANIFEST') &&
      !canManifest(pair.constellation.stage)
    ) {
      return { usable: false, reason: '현재 성좌 상태로는 현신 불가' };
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
 * 제출된 행동을 확정한다.
 * 조작 주체가 AUTO 이거나 행동이 비어 있으면 자동 행동으로 채운다.
 */
function resolveActorAction(
  side: ActorSide,
  pair: PairState,
  enemy: EnemyState | null,
): ResolvedAction {
  const submittedId =
    side === 'HUNTER' ? pair.submission.hunterActionId : pair.submission.constellationActionId;
  const control = side === 'HUNTER' ? pair.hunter.control : pair.constellation.control;
  const submitted = resolveActionFor(pair, side, submittedId);

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
  actions: Array<{ action: ActionDefinition; scaleBuff: number; scaleDebuff: number }>,
): StatusPlan {
  const plan: StatusPlan = {
    hunterStatuses: pair.hunter.statuses,
    constellationStatuses: pair.constellation.statuses,
    enemyStatuses: enemy?.statuses ?? [],
    applied: [],
    notes: [],
  };

  for (const { action, scaleBuff, scaleDebuff } of actions) {
    for (const defId of action.effect.applyStatusIds ?? []) {
      const def = findStatus(defId);
      if (!def) continue;

      const holder = action.effect.statusHolder ?? def.appliesTo;
      const scale = def.kind === 'BUFF' ? scaleBuff : scaleDebuff;
      const sourceLabel = action.label;

      if (holder === 'ENEMY') {
        if (!enemy) continue;
        plan.enemyStatuses = applyStatus(plan.enemyStatuses, defId, sourceLabel, scale);
        plan.applied.push({ holder, ownerId: enemy.id, defId, label: def.label, scale });
      } else if (holder === 'HUNTER') {
        plan.hunterStatuses = applyStatus(plan.hunterStatuses, defId, sourceLabel, scale);
        plan.applied.push({ holder, ownerId: pair.id, defId, label: def.label, scale });
      } else {
        plan.constellationStatuses = applyStatus(
          plan.constellationStatuses,
          defId,
          sourceLabel,
          scale,
        );
        plan.applied.push({ holder, ownerId: pair.id, defId, label: def.label, scale });
      }

      plan.notes.push(
        `${def.label} 부여 (${def.duration}R${scale !== 1 ? ` · ×${round2(scale)}` : ''})`,
      );
    }
  }

  return plan;
}

/* ── 페어 예상 결과 ────────────────────────────────────── */

function previewPair(state: BattleState, pair: PairState): PairPreview {
  const enemy = resolveTarget(state, pair);
  const notes: string[] = [];

  if (isDown(pair.hunter)) {
    notes.push('헌터 전투 불능 — 행동 처리 없음 (구조는 Phase 3)');
    return {
      pairId: pair.id,
      pairLabel: pair.label,
      hunterActionId: null,
      hunterActionLabel: '—',
      constellationActionId: null,
      constellationActionLabel: '—',
      usedSkills: [],
      appliedStatuses: [],
      autoFilled: [],
      targetEnemyId: enemy?.id ?? null,
      apSpent: { hunter: 0, constellation: 0 },
      damageToEnemy: 0,
      damageReduction: 0,
      revealPattern: false,
      notes,
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

  // 1) 버프 / 디버프 처리 — 이번 라운드 행동에 바로 반영된다
  //    레이드에서는 페어마다 독립적으로 계산한다. 같은 라운드에 다른 페어가 건
  //    디버프는 다음 라운드부터 반영된다 (교차 반영은 Phase 3 연계에서 다룬다).
  const plan = planStatuses(pair, enemy, [
    { action: constellationResolved.action, scaleBuff: buffScale, scaleDebuff: debuffScale },
    { action: hunterResolved.action, scaleBuff: 1, scaleDebuff: 1 },
  ]);
  notes.push(...plan.notes);

  const constellationEffect = constellationResolved.action.effect;
  const directHunterMods: StatusModifiers = {
    attackUp: (constellationEffect.attackUp ?? 0) * buffScale,
  };
  const directEnemyMods: StatusModifiers = {
    defenseDown: (constellationEffect.enemyDefenseDown ?? 0) * debuffScale,
  };

  const hunterMods = mergeModifiers(aggregateModifiers(plan.hunterStatuses), directHunterMods);
  const enemyMods = mergeModifiers(aggregateModifiers(plan.enemyStatuses), directEnemyMods);

  if (buffScale !== 1 && (hunterMods.attackUp || enemyMods.defenseDown)) {
    notes.push(`권능 배율 ×${buffScale}`);
  }

  // 2) 헌터 행동 처리
  const hunterEffect = hunterResolved.action.effect;
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

  // 성좌의 직접 공격(현신 등)도 같은 경로로 처리한다
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

  const damageReduction = hunterEffect.damageReduction ?? 0;
  if (damageReduction > 0) {
    notes.push(`방어 확보 — 받는 피해 ${Math.round(damageReduction * 100)}% 감소`);
  }

  // 사용한 커스텀 스킬 기록 — 쿨타임과 사용 횟수 차감 대상
  const usedSkills: PairPreview['usedSkills'] = [];
  if (findSkillRuntime(pair, 'HUNTER', hunterResolved.action.id)) {
    usedSkills.push({ side: 'HUNTER', skillId: hunterResolved.action.id });
  }
  if (findSkillRuntime(pair, 'CONSTELLATION', constellationResolved.action.id)) {
    usedSkills.push({ side: 'CONSTELLATION', skillId: constellationResolved.action.id });
  }

  return {
    pairId: pair.id,
    pairLabel: pair.label,
    hunterActionId: hunterResolved.action.id,
    hunterActionLabel: hunterResolved.action.label,
    constellationActionId: constellationResolved.action.id,
    constellationActionLabel: constellationResolved.action.label,
    usedSkills,
    appliedStatuses: plan.applied,
    autoFilled,
    targetEnemyId: enemy?.id ?? null,
    apSpent: {
      hunter: hunterResolved.action.apCost,
      constellation: constellationResolved.action.apCost,
    },
    damageToEnemy,
    damageReduction,
    revealPattern: Boolean(constellationEffect.revealPattern),
    notes,
    skipped: false,
  };
}

/* ── 적 행동 ───────────────────────────────────────────── */

/**
 * Phase 1 은 단일 대상 공격만 처리한다. 패턴과 광역 공격은 Phase 4.
 * 대상은 라운드 번호로 순환시켜 특정 페어만 계속 맞지 않도록 한다.
 */
function previewEnemies(
  state: BattleState,
  pairPreviews: PairPreview[],
  mergedEnemyStatuses: Map<string, StatusEffect[]>,
): EnemyActionPreview[] {
  const targets = state.pairs.filter((pair) => pair.hunter.hp > 0);
  if (targets.length === 0) return [];

  return state.enemies
    .filter((enemy) => enemy.hp > 0)
    .map((enemy, enemyIndex) => {
      const target = targets[(state.round - 1 + enemyIndex) % targets.length];
      const preview = pairPreviews.find((row) => row.pairId === target.id);
      const enemyStatuses = mergedEnemyStatuses.get(enemy.id) ?? enemy.statuses;
      const enemyMods = aggregateModifiers(enemyStatuses);

      if (enemyMods.blockAction) {
        return {
          enemyId: enemy.id,
          enemyName: enemy.name,
          pattern: enemy.nextPattern,
          targetPairId: target.id,
          damageToHunter: 0,
          blocked: true,
          notes: ['행동 불가 상태 — 공격 취소'],
        };
      }

      const hunterMods = aggregateModifiers(target.hunter.statuses);
      const result = enemyAttackDamage({
        enemy,
        hunter: target.hunter,
        damageReduction: preview?.damageReduction ?? 0,
        hunterModifiers: hunterMods,
        enemyModifiers: enemyMods,
      });

      return {
        enemyId: enemy.id,
        enemyName: enemy.name,
        pattern: enemy.nextPattern,
        targetPairId: target.id,
        damageToHunter: result.amount,
        blocked: false,
        notes: [`대상 ${target.label} (${target.hunter.name})`, ...result.notes],
      };
    });
}

/**
 * 이번 라운드에 부여될 상태이상까지 반영한 적별 상태 목록.
 * 여러 페어가 같은 적에게 디버프를 걸 수 있으므로 한 번에 합친다.
 */
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
      const amount = Math.max(
        1,
        Math.round(def.modifiers.dotDamage * Math.max(1, effect.stacks) * (effect.scale ?? 1)),
      );
      ticks.push({
        holder: 'ENEMY',
        ownerId: enemy.id,
        ownerLabel: enemy.name,
        defId: def.id,
        label: def.label,
        amount,
      });
    }
  }

  for (const pair of state.pairs) {
    if (pair.hunter.hp <= 0) continue;
    const applied = pairPreviews.find((row) => row.pairId === pair.id);
    let statuses = pair.hunter.statuses;
    for (const application of applied?.appliedStatuses ?? []) {
      if (application.holder === 'HUNTER') {
        statuses = applyStatus(statuses, application.defId, pair.label);
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
        amount: Math.max(
          1,
          Math.round(def.modifiers.dotDamage * Math.max(1, effect.stacks) * (effect.scale ?? 1)),
        ),
      });
    }
  }

  return ticks;
}

export function previewRound(state: BattleState): RoundPreview {
  const pairPreviews = state.pairs.map((pair) => previewPair(state, pair));
  const mergedEnemyStatuses = mergeEnemyStatuses(state, pairPreviews);
  const enemyPreviews = previewEnemies(state, pairPreviews, mergedEnemyStatuses);
  const statusTicks = previewStatusTicks(state, pairPreviews, mergedEnemyStatuses);

  return {
    round: state.round,
    pairs: pairPreviews,
    enemies: enemyPreviews,
    statusTicks,
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
  const log = (text: string, detail?: string, pairId: string | null = null) => {
    entries.push(createLogEntry({ round: preview.round, text, detail, pairId }, now));
  };

  log(`ROUND ${String(preview.round).padStart(2, '0')} PROCESSING`);

  // 1) 페어 행동 — 행동력, 스킬 쿨타임, 상태이상 반영
  const pairs = state.pairs.map((pair) => {
    const row = preview.pairs.find((candidate) => candidate.pairId === pair.id);
    if (!row) return pair;

    if (row.skipped) {
      log(`${pair.label} SKIPPED`, row.skipReason, pair.id);
      return pair;
    }

    if (row.hunterActionId) {
      log(
        `${pair.label} HUNTER ACTION — ${row.hunterActionLabel}`,
        `AP -${row.apSpent.hunter}${row.autoFilled.includes('HUNTER') ? ' · AUTO' : ''}`,
        pair.id,
      );
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
          ? hunterSkills.find((row2) => row2.id === used.skillId)
          : constellationSkills.find((row2) => row2.id === used.skillId);
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

    let hunterStatuses = pair.hunter.statuses;
    let constellationStatuses = pair.constellation.statuses;
    for (const application of row.appliedStatuses) {
      if (application.holder === 'HUNTER') {
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
      },
      patternRevealed: row.revealPattern,
    };
  });

  // 2) 적 상태이상 + 피해 반영
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

    const damage = damageByEnemy.get(enemy.id) ?? 0;
    const hp = Math.max(0, enemy.hp - damage);
    if (damage > 0) {
      log(`TARGET ${enemy.name} HP ${enemy.hp} > ${hp}`, `TOTAL DAMAGE ${damage}`);
      if (hp === 0) log(`TARGET DOWN — ${enemy.name}`);
    }

    return { ...enemy, hp, statuses };
  });

  // 3) 적 행동 반영
  for (const row of preview.enemies) {
    const targetIndex = pairs.findIndex((pair) => pair.id === row.targetPairId);
    if (targetIndex < 0) continue;

    if (row.blocked) {
      log(`${row.enemyName} ACTION BLOCKED`, row.notes.join(' / '));
      continue;
    }
    if (row.damageToHunter <= 0) continue;

    const enemyStillAlive = enemies.find((enemy) => enemy.id === row.enemyId);
    if (enemyStillAlive && enemyStillAlive.hp === 0) {
      log(`${row.enemyName} ACTION CANCELLED`, '대상 처치로 행동 취소');
      continue;
    }

    const target = pairs[targetIndex];
    const hp = Math.max(0, target.hunter.hp - row.damageToHunter);
    log(
      `${row.enemyName} → ${target.label} DAMAGE ${row.damageToHunter}`,
      row.notes.join(' / '),
      target.id,
    );
    log(`${target.label} HUNTER HP ${target.hunter.hp} > ${hp}`, undefined, target.id);

    pairs[targetIndex] = { ...target, hunter: { ...target.hunter, hp } };

    if (hp === 0) {
      log(`CRITICAL — HUNTER DOWN (${target.label})`, undefined, target.id);
    } else {
      const injury = injuryOf(pairs[targetIndex].hunter);
      log(`${target.label} STATUS ${injury.label}`, injury.labelKo, target.id);
    }
  }

  // 4) 지속 피해 정산
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
    if (hp === 0) log(`CRITICAL — HUNTER DOWN (${pairs[index].label})`, undefined, pairs[index].id);
  }

  // 5) 종료 판정
  const allEnemiesDown = enemies.every((enemy) => enemy.hp === 0);
  const allHuntersDown = pairs.every((pair) => pair.hunter.hp === 0);

  if (allEnemiesDown || allHuntersDown) {
    log(allEnemiesDown ? 'OPERATION CLEARED' : 'OPERATION FAILED — ALL HUNTERS DOWN');
    return {
      ...state,
      pairs,
      enemies,
      status: allEnemiesDown ? 'CLEARED' : 'FAILED',
      log: appendLog(state.log, entries),
    };
  }

  // 6) 라운드 종료 — 상태이상 지속시간, 쿨타임, 행동력 회복
  enemies = enemies.map((enemy) => {
    const ticked = tickStatuses(enemy.statuses);
    for (const expired of ticked.expired) {
      log(`STATUS EXPIRED — ${expired.label}`, enemy.name);
    }
    return { ...enemy, statuses: ticked.statuses };
  });

  const nextRound = state.round + 1;
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
    log: appendLog(state.log, entries),
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
    submitted?: boolean;
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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
