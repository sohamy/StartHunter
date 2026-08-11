/**
 * 페어 연계 판정.
 *
 * 조건은 config/combos.ts 의 데이터이고, 이 파일은 그 데이터를 해석할 뿐이다.
 * 새 연계를 추가할 때 이 파일을 고칠 필요가 없어야 한다.
 */

import { sortedCombos, type ComboDefinition, type ComboEffect } from '../config/combos';
import type { ActionDefinition, ComboResultView, StatusEffect } from '../types';

export interface ComboContext {
  hunterAction: ActionDefinition;
  constellationAction: ActionDefinition;
  /** 이번 라운드 시작 시점의 적 상태이상 */
  enemyStatuses: StatusEffect[];
}

export interface ComboResult {
  definition: ComboDefinition;
  effect: ComboEffect;
  view: ComboResultView;
}

function includesAny(source: string[] | undefined, required: string[] | undefined): boolean {
  if (!required || required.length === 0) return true;
  if (!source || source.length === 0) return false;
  return required.some((item) => source.includes(item));
}

function matches(definition: ComboDefinition, context: ComboContext): boolean {
  const { condition } = definition;
  const hunter = context.hunterAction;
  const constellation = context.constellationAction;

  if (condition.hunterKinds && !condition.hunterKinds.includes(hunter.kind)) return false;
  if (condition.constellationKinds && !condition.constellationKinds.includes(constellation.kind)) {
    return false;
  }
  if (!includesAny(hunter.effect.applyStatusIds, condition.hunterAppliesStatus)) return false;
  if (!includesAny(constellation.effect.applyStatusIds, condition.constellationAppliesStatus)) {
    return false;
  }
  if (condition.enemyHasStatus) {
    const held = context.enemyStatuses.map((effect) => effect.defId);
    if (!condition.enemyHasStatus.some((defId) => held.includes(defId))) return false;
  }
  if (condition.hunterDealsDamage && !hunter.effect.damage) return false;

  return true;
}

function describe(effect: ComboEffect): string[] {
  const lines: string[] = [];
  if (effect.damageBonus) lines.push(`피해 +${Math.round(effect.damageBonus * 100)}%`);
  if (effect.ignoreDefense) lines.push(`방어 무시 ${Math.round(effect.ignoreDefense * 100)}%`);
  if (effect.damageReduction) {
    lines.push(`받는 피해 −${Math.round(effect.damageReduction * 100)}%`);
  }
  if (effect.counterDamage) lines.push(`반격 ${effect.counterDamage}`);
  if (effect.rescueBonus) lines.push(`구조 회복 +${Math.round(effect.rescueBonus * 100)}%`);
  if (effect.gimmickBonus) lines.push(`기믹 진행 +${effect.gimmickBonus}`);
  if (effect.applyStatusIds?.length) lines.push(`추가 상태이상 ${effect.applyStatusIds.join(' · ')}`);
  return lines;
}

/** 성립한 연계 하나를 돌려준다. 우선순위가 높은(값이 작은) 것이 먼저 검사된다. */
export function detectCombo(context: ComboContext): ComboResult | null {
  for (const definition of sortedCombos()) {
    if (!matches(definition, context)) continue;

    return {
      definition,
      effect: definition.effect,
      view: {
        id: definition.id,
        label: definition.label,
        labelKo: definition.labelKo,
        description: definition.description,
        effects: describe(definition.effect),
      },
    };
  }

  return null;
}

/** 선택 단계에서 연계 가능 여부를 미리 보여주기 위한 헬퍼 */
export function previewCombo(
  hunterAction: ActionDefinition | null,
  constellationAction: ActionDefinition | null,
  enemyStatuses: StatusEffect[],
): ComboResult | null {
  if (!hunterAction || !constellationAction) return null;
  return detectCombo({ hunterAction, constellationAction, enemyStatuses });
}
