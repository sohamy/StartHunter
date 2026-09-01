/**
 * 이번 라운드에 어떤 상태이상이 붙는가.
 *
 * 붙일지 말지는 여기서 정하고, 실제로 얹는 것은 적용 단계가 한다 —
 * 미리보기에서 운영진이 손으로 고칠 수 있어야 하기 때문이다.
 */

import { findStatus } from '../../config/status';
import type {
  ActionDefinition,
  EnemyState,
  PairState,
  StatusApplication,
  StatusEffect,
} from '../../types';
import { applyStatus } from '../status';
import { round2 } from './shared';


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
export interface StatusTraitContext {
  /** 적에게 거는 상태이상의 지속 라운드 추가 (재앙 권역) */
  enemyDurationBonus: number;
  /** 피해 감소 상태이상을 걸 때의 효과 배율 (수호 권역 · 방어 전담형) */
  guardAmplifier: number;
  /** 보호 행동으로 걸 때의 효과 배율 */
  protectAmplifier: number;
}

export function planStatuses(
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

