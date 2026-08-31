/**
 * 상태이상 정의.
 *
 * 새 상태이상을 추가하려면 이 배열에 항목을 넣으면 된다.
 * 엔진은 modifiers 필드를 해석할 뿐 개별 상태이상 이름을 알지 않는다.
 */

import type { StatusHolder, StatusKind } from '../types';

/** 상태이상이 수치에 개입하는 방식 */
export interface StatusModifiers {
  /** 보유자의 공격력 증가 비율 */
  attackUp?: number;
  /** 보유자의 공격력 감소 비율 */
  attackDown?: number;
  /** 보유자의 방어력 감소 비율 */
  defenseDown?: number;
  /** 보유자가 받는 피해 증가 비율 */
  damageTaken?: number;
  /** 보유자가 받는 피해 감소 비율 */
  damageReduction?: number;
  /** 라운드 종료 시 보유자에게 들어가는 고정 피해 */
  dotDamage?: number;
  /** 행동 불가 */
  blockAction?: boolean;
  /** 회복 차단 — 회복 스킬과 아이템이 통하지 않는다 */
  healBlock?: boolean;
}

export interface StatusDefinition {
  id: string;
  label: string;
  labelKo: string;
  kind: StatusKind;
  /** 기본 부여 대상 */
  appliesTo: StatusHolder;
  /** 지속 라운드 */
  duration: number;
  stackable: boolean;
  maxStacks: number;
  modifiers: StatusModifiers;
  description: string;
}

export const STATUS_DEFINITIONS: StatusDefinition[] = [
  {
    id: 'atk.up',
    label: 'ATK UP',
    labelKo: '공격력 증가',
    kind: 'BUFF',
    appliesTo: 'HUNTER',
    duration: 2,
    stackable: false,
    maxStacks: 1,
    modifiers: { attackUp: 0.3 },
    description: '성좌의 권능으로 헌터의 공격력이 올라간다.',
  },
  {
    id: 'atk.up.great',
    label: 'ATK UP+',
    labelKo: '공격력 대폭 증가',
    kind: 'BUFF',
    appliesTo: 'HUNTER',
    duration: 3,
    stackable: false,
    maxStacks: 1,
    modifiers: { attackUp: 0.5 },
    description: '권능을 크게 쏟아부어 공격력을 끌어올린다.',
  },
  {
    id: 'stat.surge',
    label: 'SURGE',
    labelKo: '능력치 각성',
    kind: 'BUFF',
    appliesTo: 'HUNTER',
    duration: 3,
    stackable: false,
    maxStacks: 1,
    modifiers: { attackUp: 0.25, damageReduction: 0.15 },
    description: '약물로 몸을 끌어올린다 — 공격력과 버티는 힘이 함께 오른다.',
  },
  {
    id: 'guard.up',
    label: 'GUARD',
    labelKo: '피해 감소',
    kind: 'BUFF',
    appliesTo: 'HUNTER',
    duration: 2,
    stackable: false,
    maxStacks: 1,
    modifiers: { damageReduction: 0.25 },
    description: '받는 피해가 줄어든다.',
  },
  {
    id: 'def.down',
    label: 'DEF DOWN',
    labelKo: '방어력 감소',
    kind: 'DEBUFF',
    appliesTo: 'ENEMY',
    duration: 2,
    stackable: true,
    maxStacks: 2,
    modifiers: { defenseDown: 0.3 },
    description: '대상의 방어력이 깎인다.',
  },
  {
    id: 'def.down.great',
    label: 'DEF DOWN+',
    labelKo: '방어력 대폭 감소',
    kind: 'DEBUFF',
    appliesTo: 'ENEMY',
    duration: 3,
    stackable: false,
    maxStacks: 1,
    modifiers: { defenseDown: 0.45 },
    description: '대상의 방어를 크게 무너뜨린다.',
  },
  {
    id: 'atk.down',
    label: 'ATK DOWN',
    labelKo: '공격력 감소',
    kind: 'DEBUFF',
    appliesTo: 'ENEMY',
    duration: 2,
    stackable: false,
    maxStacks: 1,
    modifiers: { attackDown: 0.25 },
    description: '대상의 공격력이 약해진다.',
  },
  {
    id: 'weak',
    label: 'WEAK POINT',
    labelKo: '약점 노출',
    kind: 'DEBUFF',
    appliesTo: 'ENEMY',
    duration: 2,
    stackable: false,
    maxStacks: 1,
    modifiers: { damageTaken: 0.2 },
    description: '약점이 드러나 받는 피해가 늘어난다.',
  },
  {
    id: 'burn',
    label: 'BURN',
    labelKo: '화상',
    kind: 'DOT',
    appliesTo: 'ENEMY',
    duration: 3,
    stackable: true,
    maxStacks: 3,
    modifiers: { dotDamage: 5 },
    description: '라운드 종료마다 지속 피해를 입는다.',
  },
  {
    id: 'bleed',
    label: 'BLEED',
    labelKo: '출혈',
    kind: 'DOT',
    appliesTo: 'ENEMY',
    duration: 2,
    stackable: true,
    maxStacks: 3,
    modifiers: { dotDamage: 4 },
    description: '라운드 종료마다 지속 피해를 입는다.',
  },
  {
    id: 'enraged',
    label: 'ENRAGED',
    labelKo: '분노',
    kind: 'BUFF',
    appliesTo: 'ENEMY',
    duration: 3,
    stackable: false,
    maxStacks: 1,
    modifiers: { attackUp: 0.4 },
    description: '대상의 공격력이 크게 올라간다.',
  },
  {
    id: 'heal.block',
    label: 'NO MEND',
    labelKo: '회복 차단',
    kind: 'DEBUFF',
    appliesTo: 'HUNTER',
    duration: 2,
    stackable: false,
    maxStacks: 1,
    modifiers: { healBlock: true },
    description: '상처가 닫히지 않는다. 회복이 통하지 않는다.',
  },
  {
    id: 'bind',
    label: 'BIND',
    labelKo: '속박',
    kind: 'CONTROL',
    appliesTo: 'ENEMY',
    duration: 1,
    stackable: false,
    maxStacks: 1,
    modifiers: { blockAction: true },
    description: '대상의 행동을 한 라운드 막는다.',
  },
];

export function findStatus(defId: string): StatusDefinition | null {
  return STATUS_DEFINITIONS.find((row) => row.id === defId) ?? null;
}

/** 커스텀 스킬 편집기에서 고를 수 있는 상태이상 */
export function selectableStatuses(): StatusDefinition[] {
  return STATUS_DEFINITIONS;
}
