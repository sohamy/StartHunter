/**
 * 제출된 행동을 실제 행동 정의로 굳힌다.
 *
 * 참가자가 보낸 것은 행동 id 와 대상뿐이다. 커스텀 스킬이면 그 사람의 스킬에서,
 * 아이템이면 가방에서 꺼내 온다. 아무것도 보내지 않았으면 자동 행동이 대신 고른다.
 */

import type { ActionDefinition, ActorSide, EnemyState, GimmickState, PairState } from '../../types';
import { decideAutoAction } from '../auto';
import { itemAvailability } from '../items';
import { resolveActionFor } from '../skills';
import { actionAvailability, submittedItemId, type Availability } from './availability';


/* ── 행동 확정 ─────────────────────────────────────────── */

export interface ResolvedAction {
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

export function resolveActorAction(
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

