/**
 * 스킬 처리.
 *
 * 커스텀 스킬을 기본 행동과 같은 ActionDefinition 으로 바꿔,
 * 라운드 엔진이 스킬과 기본 행동을 구분하지 않고 처리하게 만든다.
 */

import { CONSTELLATION_ACTIONS, HUNTER_ACTIONS, findAction } from '../config/actions';
import { SKILL_RULES, findSkillKind } from '../config/skills';
import type {
  ActionDefinition,
  ActorSide,
  ConstellationState,
  HunterState,
  PairState,
  SkillDefinition,
  SkillRuntime,
} from '../types';

/** 시트의 스킬 정의를 전투용 런타임 상태로 만든다. */
export function toRuntime(skills: SkillDefinition[]): SkillRuntime[] {
  return skills.map((skill) => ({
    ...skill,
    currentCooldown: 0,
    remainingUses: skill.maxUses,
  }));
}

/** 스킬을 행동 정의로 변환한다. 종류에 따라 효과 필드가 달라진다. */
export function skillToAction(skill: SkillRuntime | SkillDefinition): ActionDefinition {
  const kindDef = findSkillKind(skill.kind);
  const effect: ActionDefinition['effect'] = {};

  switch (skill.kind) {
    case 'ATTACK':
    case 'MANIFESTATION':
      effect.damage = skill.power;
      break;
    case 'DEFENSE':
      effect.damageReduction = skill.power;
      break;
    case 'BUFF':
      effect.attackUp = skill.power;
      break;
    case 'DEBUFF':
      effect.enemyDefenseDown = skill.power;
      break;
    default:
      break;
  }

  if (skill.applyStatusIds.length > 0) {
    effect.applyStatusIds = skill.applyStatusIds;
  }

  return {
    id: skill.id,
    side: skill.side,
    kind: skill.kind === 'MANIFESTATION' ? 'MANIFEST' : (skill.kind as ActionDefinition['kind']),
    label: skill.name || 'UNNAMED SKILL',
    labelKo: kindDef?.labelKo ?? '스킬',
    description: skill.description,
    apCost: skill.apCost,
    target: skill.target,
    effect,
    implementedIn: kindDef?.activeFrom ?? 2,
  };
}

function actorOf(pair: PairState, side: ActorSide): HunterState | ConstellationState {
  return side === 'HUNTER' ? pair.hunter : pair.constellation;
}

/** 기본 행동 목록 */
export function baseActions(side: ActorSide): ActionDefinition[] {
  return side === 'HUNTER' ? HUNTER_ACTIONS : CONSTELLATION_ACTIONS;
}

/** 해당 페어에서 이 주체가 고를 수 있는 모든 행동 (기본 행동 + 커스텀 스킬) */
export function actionsFor(pair: PairState, side: ActorSide): ActionDefinition[] {
  const skills = actorOf(pair, side).skills.map(skillToAction);
  return [...baseActions(side), ...skills];
}

/** 행동 id 를 해석한다. 기본 행동에 없으면 이 주체의 스킬에서 찾는다. */
export function resolveActionFor(
  pair: PairState,
  side: ActorSide,
  actionId: string | null,
): ActionDefinition | null {
  if (!actionId) return null;

  const base = findAction(actionId);
  if (base && base.side === side) return base;

  const skill = actorOf(pair, side).skills.find((row) => row.id === actionId);
  return skill ? skillToAction(skill) : null;
}

/** 페어 전체에서 행동 id 를 찾는다 (UI 표기용 — 어느 쪽이든 상관없을 때) */
export function resolveAnyAction(pair: PairState, actionId: string | null): ActionDefinition | null {
  return (
    resolveActionFor(pair, 'HUNTER', actionId) ?? resolveActionFor(pair, 'CONSTELLATION', actionId)
  );
}

export function findSkillRuntime(
  pair: PairState,
  side: ActorSide,
  actionId: string,
): SkillRuntime | null {
  return actorOf(pair, side).skills.find((skill) => skill.id === actionId) ?? null;
}

export interface SkillAvailability {
  usable: boolean;
  reason?: string;
}

export function skillAvailability(skill: SkillRuntime): SkillAvailability {
  if (skill.currentCooldown > 0) {
    return { usable: false, reason: `쿨타임 ${skill.currentCooldown} 라운드` };
  }
  if (skill.remainingUses !== null && skill.remainingUses <= 0) {
    return { usable: false, reason: '사용 횟수 소진' };
  }
  return { usable: true };
}

/** 스킬을 사용한 직후 상태 — 쿨타임 설정, 사용 횟수 차감 */
export function consumeSkill(skills: SkillRuntime[], skillId: string): SkillRuntime[] {
  return skills.map((skill) => {
    if (skill.id !== skillId) return skill;
    return {
      ...skill,
      currentCooldown: skill.cooldown,
      remainingUses: skill.remainingUses === null ? null : Math.max(0, skill.remainingUses - 1),
    };
  });
}

/** 라운드 종료 처리 — 쿨타임을 1 줄인다 */
export function tickCooldowns(skills: SkillRuntime[]): SkillRuntime[] {
  return skills.map((skill) =>
    skill.currentCooldown > 0 ? { ...skill, currentCooldown: skill.currentCooldown - 1 } : skill,
  );
}

/* ── 시트 검증 ─────────────────────────────────────────── */

export interface SkillIssue {
  skillIndex: number;
  message: string;
}

export function validateSkills(skills: SkillDefinition[], side: ActorSide): SkillIssue[] {
  const issues: SkillIssue[] = [];

  if (skills.length > SKILL_RULES.maxSkills) {
    issues.push({
      skillIndex: -1,
      message: `스킬은 최대 ${SKILL_RULES.maxSkills}개까지 등록할 수 있습니다.`,
    });
  }

  skills.forEach((skill, index) => {
    const name = skill.name.trim();
    if (name.length < 1) {
      issues.push({ skillIndex: index, message: `${index + 1}번 스킬의 이름을 입력하세요.` });
    } else if (name.length > SKILL_RULES.nameMaxLength) {
      issues.push({
        skillIndex: index,
        message: `${index + 1}번 스킬 이름은 ${SKILL_RULES.nameMaxLength}자 이내로 입력하세요.`,
      });
    }

    const kindDef = findSkillKind(skill.kind);
    if (!kindDef || !kindDef.sides.includes(side)) {
      issues.push({ skillIndex: index, message: `${index + 1}번 스킬의 종류가 올바르지 않습니다.` });
    }

    if (skill.apCost < SKILL_RULES.apCost.min || skill.apCost > SKILL_RULES.apCost.max) {
      issues.push({
        skillIndex: index,
        message: `${index + 1}번 스킬의 행동력은 ${SKILL_RULES.apCost.min}~${SKILL_RULES.apCost.max} 범위여야 합니다.`,
      });
    }

    if (skill.power < SKILL_RULES.power.min || skill.power > SKILL_RULES.power.max) {
      issues.push({
        skillIndex: index,
        message: `${index + 1}번 스킬의 기본 수치는 ${SKILL_RULES.power.min}~${SKILL_RULES.power.max} 범위여야 합니다.`,
      });
    }

    if (skill.cooldown < SKILL_RULES.cooldown.min || skill.cooldown > SKILL_RULES.cooldown.max) {
      issues.push({
        skillIndex: index,
        message: `${index + 1}번 스킬의 쿨타임은 ${SKILL_RULES.cooldown.min}~${SKILL_RULES.cooldown.max} 범위여야 합니다.`,
      });
    }

    if (skill.applyStatusIds.length > SKILL_RULES.maxStatuses) {
      issues.push({
        skillIndex: index,
        message: `${index + 1}번 스킬의 상태이상은 최대 ${SKILL_RULES.maxStatuses}개까지 지정할 수 있습니다.`,
      });
    }

    if (skill.description.length > SKILL_RULES.descriptionMaxLength) {
      issues.push({ skillIndex: index, message: `${index + 1}번 스킬 설명이 너무 깁니다.` });
    }
  });

  return issues;
}
