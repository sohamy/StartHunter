/**
 * 라운드 처리.
 *
 * 흐름은 요구사항서 4장을 따른다.
 *   행동 확정 → 버프/디버프 → 헌터·성좌 행동 → (연계: Phase 3) → 적 행동 → 정산
 *
 * previewRound() 는 상태를 바꾸지 않고 예상 결과만 만든다.
 * applyRound() 는 preview 를 받아 실제 상태를 만든다.
 * 이 사이에 운영진 수정 단계(Phase 5)를 끼워 넣을 수 있어야 하므로 둘을 분리해 둔다.
 */

import { findAction } from '../config/actions';
import { AP_RULES, CURRENT_PHASE } from '../config/rules';
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
} from '../types';
import { decideAutoAction } from './auto';
import { clearSubmissions, resolveTarget } from './battle';
import { enemyAttackDamage, hunterAttackDamage } from './damage';
import { appendLog, createLogEntry } from './log';
import { canManifest, constellationMaxAp, injuryOf, isDown } from './status';

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

  if (action.side === 'HUNTER' && isDown(pair.hunter) && action.kind !== 'WAIT') {
    return { usable: false, reason: '전투 불능' };
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

/* ── 예상 결과 ─────────────────────────────────────────── */

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
  const submitted = findAction(submittedId);

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

function previewPair(state: BattleState, pair: PairState): PairPreview {
  const enemy = resolveTarget(state, pair);
  const notes: string[] = [];

  if (isDown(pair.hunter)) {
    notes.push('헌터 전투 불능 — 행동 처리 없음 (구조는 Phase 3)');
    return {
      pairId: pair.id,
      pairLabel: pair.label,
      hunterActionId: null,
      constellationActionId: null,
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

  // 1) 성좌 효과를 먼저 계산한다 (버프 / 디버프 / 계시)
  const constellationEffect = constellationResolved.action.effect;
  const attackUp = constellationEffect.attackUp ?? 0;
  const enemyDefenseDown = constellationEffect.enemyDefenseDown ?? 0;
  const revealPattern = Boolean(constellationEffect.revealPattern);

  // 2) 헌터 행동을 처리한다
  const hunterEffect = hunterResolved.action.effect;
  let damageToEnemy = 0;

  if (hunterEffect.damage && enemy) {
    const result = hunterAttackDamage({
      hunter: pair.hunter,
      enemy,
      powerRatio: hunterEffect.damage,
      attackUp,
      enemyDefenseDown,
    });
    damageToEnemy = result.amount;
    notes.push(...result.notes);
  }

  const damageReduction = hunterEffect.damageReduction ?? 0;
  if (damageReduction > 0) {
    notes.push(`방어 확보 — 받는 피해 ${Math.round(damageReduction * 100)}% 감소`);
  }

  return {
    pairId: pair.id,
    pairLabel: pair.label,
    hunterActionId: hunterResolved.action.id,
    constellationActionId: constellationResolved.action.id,
    autoFilled,
    targetEnemyId: enemy?.id ?? null,
    apSpent: {
      hunter: hunterResolved.action.apCost,
      constellation: constellationResolved.action.apCost,
    },
    damageToEnemy,
    damageReduction,
    revealPattern,
    notes,
    skipped: false,
  };
}

/**
 * 적 행동.
 * Phase 1 은 단일 대상 공격만 처리한다. 패턴과 광역 공격은 Phase 4.
 * 대상은 라운드 번호로 순환시켜 특정 페어만 계속 맞지 않도록 한다.
 */
function previewEnemies(
  state: BattleState,
  pairPreviews: PairPreview[],
): EnemyActionPreview[] {
  const targets = state.pairs.filter((pair) => pair.hunter.hp > 0);
  if (targets.length === 0) return [];

  return state.enemies
    .filter((enemy) => enemy.hp > 0)
    .map((enemy, enemyIndex) => {
      const target = targets[(state.round - 1 + enemyIndex) % targets.length];
      const preview = pairPreviews.find((row) => row.pairId === target.id);
      const result = enemyAttackDamage({
        enemy,
        damageReduction: preview?.damageReduction ?? 0,
      });

      return {
        enemyId: enemy.id,
        enemyName: enemy.name,
        pattern: enemy.nextPattern,
        targetPairId: target.id,
        damageToHunter: result.amount,
        notes: [`대상 ${target.label} (${target.hunter.name})`, ...result.notes],
      };
    });
}

export function previewRound(state: BattleState): RoundPreview {
  const pairPreviews = state.pairs.map((pair) => previewPair(state, pair));
  const enemyPreviews = previewEnemies(state, pairPreviews);

  return {
    round: state.round,
    pairs: pairPreviews,
    enemies: enemyPreviews,
    totals: {
      damageToEnemies: pairPreviews.reduce((sum, row) => sum + row.damageToEnemy, 0),
      damageToHunters: enemyPreviews.reduce((sum, row) => sum + row.damageToHunter, 0),
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

  // 페어 행동 반영
  const pairs = state.pairs.map((pair) => {
    const row = preview.pairs.find((candidate) => candidate.pairId === pair.id);
    if (!row) return pair;

    if (row.skipped) {
      log(`${pair.label} SKIPPED`, row.skipReason, pair.id);
      return pair;
    }

    const hunterAction = findAction(row.hunterActionId);
    const constellationAction = findAction(row.constellationActionId);

    if (hunterAction) {
      log(
        `${pair.label} HUNTER ACTION — ${hunterAction.label}`,
        `AP -${row.apSpent.hunter}${row.autoFilled.includes('HUNTER') ? ' · AUTO' : ''}`,
        pair.id,
      );
    }
    if (constellationAction) {
      log(
        `${pair.label} CONSTELLATION AUTHORITY — ${constellationAction.label}`,
        `AP -${row.apSpent.constellation}${
          row.autoFilled.includes('CONSTELLATION') ? ' · AUTO' : ''
        }`,
        pair.id,
      );
    }
    if (row.autoFilled.length > 0) {
      log(`${pair.label} AUTO CONTROL ENGAGED`, row.autoFilled.join(' / '), pair.id);
    }

    return {
      ...pair,
      hunter: { ...pair.hunter, ap: Math.max(0, pair.hunter.ap - row.apSpent.hunter) },
      constellation: {
        ...pair.constellation,
        ap: Math.max(0, pair.constellation.ap - row.apSpent.constellation),
      },
      patternRevealed: row.revealPattern,
    };
  });

  // 적 피해 반영
  const damageByEnemy = new Map<string, number>();
  for (const row of preview.pairs) {
    if (!row.targetEnemyId || row.damageToEnemy <= 0) continue;
    damageByEnemy.set(
      row.targetEnemyId,
      (damageByEnemy.get(row.targetEnemyId) ?? 0) + row.damageToEnemy,
    );
    log(`${row.pairLabel} DAMAGE ${row.damageToEnemy}`, row.notes.join(' / '), row.pairId);
  }

  const enemies = state.enemies.map((enemy) => {
    const damage = damageByEnemy.get(enemy.id) ?? 0;
    if (damage <= 0) return enemy;

    const hp = Math.max(0, enemy.hp - damage);
    log(`TARGET ${enemy.name} HP ${enemy.hp} > ${hp}`, `TOTAL DAMAGE ${damage}`);
    if (hp === 0) log(`TARGET DOWN — ${enemy.name}`);
    return { ...enemy, hp };
  });

  // 적 행동 반영
  for (const row of preview.enemies) {
    const targetIndex = pairs.findIndex((pair) => pair.id === row.targetPairId);
    if (targetIndex < 0 || row.damageToHunter <= 0) continue;

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

  // 종료 판정
  const allEnemiesDown = enemies.every((enemy) => enemy.hp === 0);
  const allHuntersDown = pairs.every((pair) => pair.hunter.hp === 0);

  if (allEnemiesDown) {
    log('OPERATION CLEARED');
    return {
      ...state,
      pairs,
      enemies,
      status: 'CLEARED',
      log: appendLog(state.log, entries),
    };
  }

  if (allHuntersDown) {
    log('OPERATION FAILED — ALL HUNTERS DOWN');
    return {
      ...state,
      pairs,
      enemies,
      status: 'FAILED',
      log: appendLog(state.log, entries),
    };
  }

  // 다음 라운드 준비 — 행동력 회복
  const nextRound = state.round + 1;
  const recovered = pairs.map((pair) => {
    const hunterMax = pair.hunter.maxAp;
    const constMax = constellationMaxAp(pair.constellation.maxAp, pair.constellation.stage);
    return {
      ...pair,
      hunter: {
        ...pair.hunter,
        ap: Math.min(hunterMax, pair.hunter.ap + AP_RULES.recoveryPerRound),
      },
      constellation: {
        ...pair.constellation,
        ap: Math.min(constMax, pair.constellation.ap + AP_RULES.recoveryPerRound),
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

/** 참가자가 행동을 확정할 때 쓰는 헬퍼 */
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
