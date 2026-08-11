/**
 * 자동 행동 판정.
 *
 * 정책은 config/autoAction.ts 의 데이터이고, 이 파일은 그 데이터를 해석할 뿐이다.
 */

import { findAction } from '../config/actions';
import { AUTO_FORBIDDEN_KINDS, AUTO_RULES, type AutoRule } from '../config/autoAction';
import { CURRENT_PHASE } from '../config/rules';
import type { ActionDefinition, ActorSide, EnemyState, PairState } from '../types';
import { canManifest, isDown } from './status';

export interface AutoDecision {
  action: ActionDefinition;
  reason: string;
  ruleId: string;
}

export interface AutoContext {
  pair: PairState;
  /** 공격 대상으로 잡힌 적. 없으면 조건 검사에서 적 관련 항목은 실패로 본다. */
  enemy: EnemyState | null;
}

function conditionsMet(rule: AutoRule, ctx: AutoContext): boolean {
  const when = rule.when;
  if (!when) return true;

  const { hunter, constellation } = ctx.pair;
  const hpPercent = hunter.maxHp > 0 ? (hunter.hp / hunter.maxHp) * 100 : 0;
  const ap = rule.side === 'HUNTER' ? hunter.ap : constellation.ap;

  if (when.hunterHpBelowPercent !== undefined && hpPercent >= when.hunterHpBelowPercent) {
    return false;
  }
  if (when.hunterHpAtLeastPercent !== undefined && hpPercent < when.hunterHpAtLeastPercent) {
    return false;
  }
  if (when.enemyDefenseAtLeast !== undefined) {
    if (!ctx.enemy || ctx.enemy.defense < when.enemyDefenseAtLeast) return false;
  }
  if (when.apAtLeast !== undefined && ap < when.apAtLeast) {
    return false;
  }
  return true;
}

function usable(action: ActionDefinition, ctx: AutoContext): boolean {
  if (action.implementedIn > CURRENT_PHASE) return false;
  if ((AUTO_FORBIDDEN_KINDS as readonly string[]).includes(action.kind)) return false;

  const ap = action.side === 'HUNTER' ? ctx.pair.hunter.ap : ctx.pair.constellation.ap;
  if (action.apCost > ap) return false;

  if (action.side === 'CONSTELLATION') {
    if (ctx.pair.constellation.stage === 'LOST') return false;
    if (
      (action.kind === 'MANIFEST' || action.kind === 'FULL_MANIFEST') &&
      !canManifest(ctx.pair.constellation.stage)
    ) {
      return false;
    }
  }
  if (action.side === 'HUNTER' && isDown(ctx.pair.hunter) && action.kind !== 'WAIT') {
    return false;
  }
  if (action.target === 'ENEMY' && !ctx.enemy) return false;

  return true;
}

/**
 * 자동 행동을 결정한다.
 * 어떤 규칙도 통과하지 못하면 대기 행동으로 떨어진다.
 */
export function decideAutoAction(side: ActorSide, ctx: AutoContext): AutoDecision {
  for (const rule of AUTO_RULES) {
    if (rule.side !== side) continue;
    if (!conditionsMet(rule, ctx)) continue;

    const action = findAction(rule.actionId);
    if (!action || !usable(action, ctx)) continue;

    return { action, reason: rule.reason, ruleId: rule.id };
  }

  const fallbackId = side === 'HUNTER' ? 'hunter.wait' : 'const.wait';
  const fallback = findAction(fallbackId);
  if (!fallback) {
    throw new Error(`자동 행동 기본값(${fallbackId})이 정의되어 있지 않습니다.`);
  }
  return { action: fallback, reason: '적용 가능한 규칙 없음 — 대기', ruleId: 'auto.fallback' };
}
