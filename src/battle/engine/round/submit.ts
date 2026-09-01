/**
 * 참가자 제출과 조작 모드.
 *
 * 라운드 계산과는 다른 층위다 — 계산 전에 무엇이 들어와 있는지를 다루는 쪽이다.
 */

import type { ActorSide, BattleState, GimmickCheck, GimmickStage } from '../../types';
import { appendLog, createLogEntry } from '../log';


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


