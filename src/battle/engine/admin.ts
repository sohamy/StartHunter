/**
 * 운영진 편집 함수.
 *
 * 원칙: **자동 판정이 운영진보다 우선해서는 안 된다.**
 * 여기 있는 함수들은 검증이나 규칙을 적용하지 않고, 운영진이 지정한 값을 그대로 반영한다.
 * (HP 상한처럼 데이터가 깨지는 값만 막는다.)
 *
 * 모든 함수는 순수 함수이며 새 상태를 돌려준다.
 */

import { emptySubmission } from '../config/scenario';
import { findStatus } from '../config/status';
import { createPair, createPresetPair, createGimmick } from './battle';
import { appendLog, createLogEntry } from './log';
import { applyStatus } from './status';
import type {
  ActorSide,
  BattleState,
  CharacterSheet,
  ConstellationStage,
  ContractStage,
  CustomAttack,
  PairState,
  SkillRuntime,
  StatusHolder,
} from '../types';

function note(state: BattleState, text: string, detail?: string, pairId: string | null = null): BattleState {
  return {
    ...state,
    log: appendLog(state.log, [
      createLogEntry({ round: state.round, text: `[ADMIN] ${text}`, detail, pairId }),
    ]),
  };
}

function patchPair(
  state: BattleState,
  pairId: string,
  updater: (pair: PairState) => PairState,
): BattleState {
  return {
    ...state,
    pairs: state.pairs.map((pair) => (pair.id === pairId ? updater(pair) : pair)),
  };
}

/* ── 헌터 ──────────────────────────────────────────────── */

export function setHunterHp(state: BattleState, pairId: string, hp: number): BattleState {
  const next = patchPair(state, pairId, (pair) => ({
    ...pair,
    hunter: { ...pair.hunter, hp: clamp(hp, 0, pair.hunter.maxHp) },
  }));
  return note(next, `HUNTER HP 변경 — ${pairId} → ${hp}`, undefined, pairId);
}

export function setHunterMaxHp(state: BattleState, pairId: string, maxHp: number): BattleState {
  const next = patchPair(state, pairId, (pair) => ({
    ...pair,
    hunter: {
      ...pair.hunter,
      maxHp: Math.max(1, maxHp),
      hp: Math.min(pair.hunter.hp, Math.max(1, maxHp)),
    },
  }));
  return note(next, `HUNTER MAX HP 변경 — ${pairId} → ${maxHp}`, undefined, pairId);
}

export function setActorAp(
  state: BattleState,
  pairId: string,
  side: ActorSide,
  ap: number,
): BattleState {
  const next = patchPair(state, pairId, (pair) =>
    side === 'HUNTER'
      ? { ...pair, hunter: { ...pair.hunter, ap: Math.max(0, ap) } }
      : { ...pair, constellation: { ...pair.constellation, ap: Math.max(0, ap) } },
  );
  return note(next, `${side} AP 변경 — ${pairId} → ${ap}`, undefined, pairId);
}

export function setActorMaxAp(
  state: BattleState,
  pairId: string,
  side: ActorSide,
  maxAp: number,
): BattleState {
  const value = Math.max(0, maxAp);
  const next = patchPair(state, pairId, (pair) =>
    side === 'HUNTER'
      ? { ...pair, hunter: { ...pair.hunter, maxAp: value, ap: Math.min(pair.hunter.ap, value) } }
      : {
          ...pair,
          constellation: {
            ...pair.constellation,
            maxAp: value,
            ap: Math.min(pair.constellation.ap, value),
          },
        },
  );
  return note(next, `${side} MAX AP 변경 — ${pairId} → ${value}`, undefined, pairId);
}

export function setHunterStats(
  state: BattleState,
  pairId: string,
  patch: { attack?: number; defense?: number },
): BattleState {
  const next = patchPair(state, pairId, (pair) => ({
    ...pair,
    hunter: {
      ...pair.hunter,
      attack: patch.attack !== undefined ? Math.max(0, patch.attack) : pair.hunter.attack,
      defense: patch.defense !== undefined ? Math.max(0, patch.defense) : pair.hunter.defense,
    },
  }));
  return note(next, `HUNTER 수치 변경 — ${pairId}`, JSON.stringify(patch), pairId);
}

/* ── 성좌 ──────────────────────────────────────────────── */

export function setConstellationStage(
  state: BattleState,
  pairId: string,
  stage: ConstellationStage,
): BattleState {
  const next = patchPair(state, pairId, (pair) => ({
    ...pair,
    constellation: { ...pair.constellation, stage },
  }));
  return note(next, `성좌 상태 변경 — ${pairId} → ${stage}`, undefined, pairId);
}

export function setConstellationPower(
  state: BattleState,
  pairId: string,
  power: number,
): BattleState {
  const next = patchPair(state, pairId, (pair) => ({
    ...pair,
    constellation: { ...pair.constellation, power: Math.max(0, power) },
  }));
  return note(next, `권능 배율 변경 — ${pairId} → ×${power}`, undefined, pairId);
}

export function setManifestUses(
  state: BattleState,
  pairId: string,
  patch: { partial?: number | null; full?: number | null },
): BattleState {
  const next = patchPair(state, pairId, (pair) => ({
    ...pair,
    constellation: {
      ...pair.constellation,
      manifestUses: { ...pair.constellation.manifestUses, ...patch },
    },
  }));
  return note(next, `현신 횟수 변경 — ${pairId}`, JSON.stringify(patch), pairId);
}

export function setContract(
  state: BattleState,
  pairId: string,
  patch: { stage?: ContractStage; value?: number },
): BattleState {
  const next = patchPair(state, pairId, (pair) => ({
    ...pair,
    contract: {
      stage: patch.stage ?? pair.contract.stage,
      value: patch.value !== undefined ? clamp(patch.value, 0, 100) : pair.contract.value,
    },
  }));
  return note(next, `계약 안정도 변경 — ${pairId}`, JSON.stringify(patch), pairId);
}

export function setPairPoints(state: BattleState, pairId: string, points: number): BattleState {
  const next = patchPair(state, pairId, (pair) => ({ ...pair, points: Math.max(0, points) }));
  return note(next, `포인트 변경 — ${pairId} → ${points}P`, undefined, pairId);
}

/* ── 상태이상 ──────────────────────────────────────────── */

export function grantStatus(
  state: BattleState,
  holder: StatusHolder,
  ownerId: string,
  defId: string,
): BattleState {
  const def = findStatus(defId);
  if (!def) return state;

  if (holder === 'ENEMY') {
    const next = {
      ...state,
      enemies: state.enemies.map((enemy) =>
        enemy.id === ownerId
          ? { ...enemy, statuses: applyStatus(enemy.statuses, defId, 'RAID CONTROL') }
          : enemy,
      ),
    };
    return note(next, `상태이상 부여 — ${ownerId} ← ${def.label}`);
  }

  const next = patchPair(state, ownerId, (pair) =>
    holder === 'HUNTER'
      ? {
          ...pair,
          hunter: {
            ...pair.hunter,
            statuses: applyStatus(pair.hunter.statuses, defId, 'RAID CONTROL'),
          },
        }
      : {
          ...pair,
          constellation: {
            ...pair.constellation,
            statuses: applyStatus(pair.constellation.statuses, defId, 'RAID CONTROL'),
          },
        },
  );
  return note(next, `상태이상 부여 — ${ownerId} ${holder} ← ${def.label}`, undefined, ownerId);
}

export function revokeStatus(
  state: BattleState,
  holder: StatusHolder,
  ownerId: string,
  defId: string,
): BattleState {
  const strip = (statuses: BattleState['enemies'][number]['statuses']) =>
    statuses.filter((effect) => effect.defId !== defId);

  if (holder === 'ENEMY') {
    const next = {
      ...state,
      enemies: state.enemies.map((enemy) =>
        enemy.id === ownerId ? { ...enemy, statuses: strip(enemy.statuses) } : enemy,
      ),
    };
    return note(next, `상태이상 제거 — ${ownerId} ✕ ${defId}`);
  }

  const next = patchPair(state, ownerId, (pair) =>
    holder === 'HUNTER'
      ? { ...pair, hunter: { ...pair.hunter, statuses: strip(pair.hunter.statuses) } }
      : {
          ...pair,
          constellation: { ...pair.constellation, statuses: strip(pair.constellation.statuses) },
        },
  );
  return note(next, `상태이상 제거 — ${ownerId} ${holder} ✕ ${defId}`, undefined, ownerId);
}

/* ── 스킬 ──────────────────────────────────────────────── */

export function patchSkill(
  state: BattleState,
  pairId: string,
  side: ActorSide,
  skillId: string,
  patch: Partial<SkillRuntime>,
): BattleState {
  const update = (skills: SkillRuntime[]) =>
    skills.map((skill) => (skill.id === skillId ? { ...skill, ...patch } : skill));

  const next = patchPair(state, pairId, (pair) =>
    side === 'HUNTER'
      ? { ...pair, hunter: { ...pair.hunter, skills: update(pair.hunter.skills) } }
      : { ...pair, constellation: { ...pair.constellation, skills: update(pair.constellation.skills) } },
  );
  return note(next, `스킬 수정 — ${pairId} ${skillId}`, JSON.stringify(patch), pairId);
}

/* ── 적 ────────────────────────────────────────────────── */

export function setEnemyHp(state: BattleState, enemyId: string, hp: number): BattleState {
  const next = {
    ...state,
    enemies: state.enemies.map((enemy) =>
      enemy.id === enemyId ? { ...enemy, hp: clamp(hp, 0, enemy.maxHp) } : enemy,
    ),
  };
  return note(next, `적 HP 변경 — ${enemyId} → ${hp}`);
}

/** 전투 중 공격 패턴 교체 — 다음 라운드 선택부터 반영된다 */
export function setEnemyAttacks(
  state: BattleState,
  enemyId: string,
  attacks: CustomAttack[],
): BattleState {
  const next = {
    ...state,
    enemies: state.enemies.map((enemy) => (enemy.id === enemyId ? { ...enemy, attacks } : enemy)),
  };
  return note(next, `적 공격 패턴 변경 — ${enemyId}`, `${attacks.length}개`);
}

export function setEnemyStats(
  state: BattleState,
  enemyId: string,
  patch: { attack?: number; defense?: number; maxHp?: number },
): BattleState {
  const next = {
    ...state,
    enemies: state.enemies.map((enemy) => {
      if (enemy.id !== enemyId) return enemy;
      const maxHp = patch.maxHp !== undefined ? Math.max(1, patch.maxHp) : enemy.maxHp;
      return {
        ...enemy,
        maxHp,
        hp: Math.min(enemy.hp, maxHp),
        attack: patch.attack !== undefined ? Math.max(0, patch.attack) : enemy.attack,
        defense: patch.defense !== undefined ? Math.max(0, patch.defense) : enemy.defense,
      };
    }),
  };
  return note(next, `적 수치 변경 — ${enemyId}`, JSON.stringify(patch));
}

export function setEnemyPhase(state: BattleState, enemyId: string, phase: number): BattleState {
  const next = {
    ...state,
    enemies: state.enemies.map((enemy) =>
      enemy.id === enemyId ? { ...enemy, phase: clamp(phase, 1, enemy.maxPhase) } : enemy,
    ),
  };
  return note(next, `보스 페이즈 변경 — ${enemyId} → PHASE ${phase}`);
}

export function clearTelegraph(state: BattleState, enemyId: string): BattleState {
  const next = {
    ...state,
    enemies: state.enemies.map((enemy) =>
      enemy.id === enemyId ? { ...enemy, telegraph: null } : enemy,
    ),
  };
  return note(next, `예고 취소 — ${enemyId}`);
}

/* ── 전투 진행 ─────────────────────────────────────────── */

export function setRound(state: BattleState, round: number): BattleState {
  const next = { ...state, round: Math.max(1, round) };
  return note(next, `라운드 변경 → ${round}`);
}

export function setBattleStatus(state: BattleState, status: BattleState['status']): BattleState {
  const next = { ...state, status };
  return note(next, `전투 상태 변경 → ${status}`);
}

export function resetAllSubmissions(state: BattleState): BattleState {
  const target = state.enemies.find((enemy) => enemy.hp > 0)?.id ?? null;
  const next = {
    ...state,
    pairs: state.pairs.map((pair) => ({
      ...pair,
      submission: { ...emptySubmission(), targetEnemyId: target },
    })),
  };
  return note(next, '전체 제출 초기화');
}

export function resetSubmission(state: BattleState, pairId: string): BattleState {
  const target = state.enemies.find((enemy) => enemy.hp > 0)?.id ?? null;
  const next = patchPair(state, pairId, (pair) => ({
    ...pair,
    submission: { ...emptySubmission(), targetEnemyId: target },
  }));
  return note(next, `제출 초기화 — ${pairId}`, undefined, pairId);
}

/* ── 이탈자 처리 ───────────────────────────────────────
   운영진이 탈주·부재를 확인하면 해당 쪽을 강제로 자동 행동으로 돌린다. */

export function forceControl(
  state: BattleState,
  pairId: string,
  side: ActorSide,
  control: 'ACTIVE' | 'AUTO',
): BattleState {
  const next = patchPair(state, pairId, (pair) =>
    side === 'HUNTER'
      ? { ...pair, hunter: { ...pair.hunter, control } }
      : { ...pair, constellation: { ...pair.constellation, control } },
  );
  return note(
    next,
    `${side} 조작 강제 전환 — ${pairId} → ${control}`,
    control === 'AUTO' ? '이탈 확인 · 자동 행동 위임' : '참가자 복귀',
    pairId,
  );
}

/** 이번 라운드 미제출인 모든 쪽을 자동 행동으로 위임한다 */
export function forceAutoForUnsubmitted(state: BattleState): BattleState {
  const targets: string[] = [];

  const pairs = state.pairs.map((pair) => {
    let next = pair;
    if (!pair.submission.hunterSubmitted && pair.hunter.control !== 'AUTO' && pair.hunter.hp > 0) {
      next = { ...next, hunter: { ...next.hunter, control: 'AUTO' } };
      targets.push(`${pair.label} HUNTER`);
    }
    if (!pair.submission.constellationSubmitted && pair.constellation.control !== 'AUTO') {
      next = { ...next, constellation: { ...next.constellation, control: 'AUTO' } };
      targets.push(`${pair.label} CONSTELLATION`);
    }
    return next;
  });

  if (targets.length === 0) return state;
  return note({ ...state, pairs }, `미제출 ${targets.length}건 자동 위임`, targets.join(' / '));
}

/* ── 페어 편성 ─────────────────────────────────────────
   짝을 맺는 권한은 운영진에게 있다. 1인 = 1캐릭터이므로
   같은 계정이 양쪽에 들어가는 편성은 만들 수 없다. */

export interface PairingInput {
  hunterSheet: CharacterSheet;
  constellationSheet: CharacterSheet;
  hunterAccountId: string | null;
  constellationAccountId: string | null;
}

export function addPairing(state: BattleState, input: PairingInput): BattleState {
  if (
    input.hunterAccountId &&
    input.constellationAccountId &&
    input.hunterAccountId === input.constellationAccountId
  ) {
    return note(state, '편성 거부 — 한 참가자가 양쪽을 맡을 수 없습니다');
  }

  const pair = createPair(state.pairs.length, {
    hunterSheet: input.hunterSheet,
    constellationSheet: input.constellationSheet,
    hunterAccountId: input.hunterAccountId,
    constellationAccountId: input.constellationAccountId,
    affiliation: input.hunterSheet.affiliation,
  });
  pair.submission.targetEnemyId = state.enemies.find((enemy) => enemy.hp > 0)?.id ?? null;

  const next = { ...state, pairs: [...state.pairs, pair] };
  return note(
    next,
    `페어 편성 — ${pair.label}`,
    `${input.hunterSheet.name}(${input.hunterAccountId ?? 'NPC'}) × ${
      input.constellationSheet.name
    }(${input.constellationAccountId ?? 'NPC'})`,
  );
}

/** 편성된 페어의 담당 계정을 교체한다 */
export function assignAccount(
  state: BattleState,
  pairId: string,
  side: ActorSide,
  accountId: string | null,
): BattleState {
  const pair = state.pairs.find((candidate) => candidate.id === pairId);
  if (!pair) return state;

  const other = side === 'HUNTER' ? pair.constellationAccountId : pair.hunterAccountId;
  if (accountId && other === accountId) {
    return note(state, '배정 거부 — 한 참가자가 양쪽을 맡을 수 없습니다', undefined, pairId);
  }

  const next = patchPair(state, pairId, (row) =>
    side === 'HUNTER'
      ? { ...row, hunterAccountId: accountId }
      : { ...row, constellationAccountId: accountId },
  );
  return note(next, `${side} 담당 배정 — ${pairId} → ${accountId ?? 'NPC'}`, undefined, pairId);
}

export function addPresetPair(state: BattleState): BattleState {
  const index = state.pairs.length;
  const pair = createPresetPair(index);
  pair.submission.targetEnemyId = state.enemies.find((enemy) => enemy.hp > 0)?.id ?? null;
  const next = { ...state, pairs: [...state.pairs, pair] };
  return note(next, `페어 추가 — ${pair.label}`);
}

export function removePair(state: BattleState, pairId: string): BattleState {
  if (state.pairs.length <= 1) return state;
  const pairs = state.pairs.filter((pair) => pair.id !== pairId);
  const next: BattleState = {
    ...state,
    pairs,
    viewerPairId: state.viewerPairId === pairId ? pairs[0].id : state.viewerPairId,
  };
  return note(next, `페어 제거 — ${pairId}`);
}

export function setGimmick(state: BattleState, defId: string | null): BattleState {
  const next = { ...state, gimmick: createGimmick(defId) };
  return note(next, `기믹 변경 → ${defId ?? 'NONE'}`);
}

export function setGimmickProgress(state: BattleState, progress: number): BattleState {
  if (!state.gimmick) return state;
  const next = {
    ...state,
    gimmick: { ...state.gimmick, progress: Math.max(0, progress) },
  };
  return note(next, `기믹 진행 변경 → ${progress}`);
}

export function setGimmickStatus(
  state: BattleState,
  status: 'ACTIVE' | 'CLEARED' | 'FAILED',
): BattleState {
  if (!state.gimmick) return state;
  const next = { ...state, gimmick: { ...state.gimmick, status } };
  return note(next, `기믹 상태 변경 → ${status}`);
}

/* ── 로그 ──────────────────────────────────────────────── */

export function editLogEntry(state: BattleState, entryId: string, text: string): BattleState {
  return {
    ...state,
    log: state.log.map((entry) => (entry.id === entryId ? { ...entry, text, edited: true } : entry)),
  };
}

export function removeLogEntry(state: BattleState, entryId: string): BattleState {
  return { ...state, log: state.log.filter((entry) => entry.id !== entryId) };
}

export function clearAlerts(state: BattleState): BattleState {
  return { ...state, alerts: [] };
}

/* ── 페어 직접 편성 ────────────────────────────────────── */

export { createPair };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
