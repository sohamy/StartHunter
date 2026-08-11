/**
 * 페어 연계 정의.
 *
 * 헌터와 성좌가 같은 라운드에 특정 조합을 쓰면 연계가 발생한다.
 * **새 연계를 추가할 때 엔진 코드를 고치지 않아야 한다** — 조건과 결과를 모두 데이터로 둔다.
 *
 * 연계 자체는 추가 행동력을 소비하지 않는다.
 */

import type { ActionKind } from '../types';

export interface ComboCondition {
  /** 헌터 행동의 종류 (하나라도 맞으면 성립) */
  hunterKinds?: ActionKind[];
  /** 성좌 행동의 종류 */
  constellationKinds?: ActionKind[];
  /** 헌터 행동이 부여하는 상태이상 중 하나라도 포함해야 함 */
  hunterAppliesStatus?: string[];
  /** 성좌 행동이 부여하는 상태이상 중 하나라도 포함해야 함 */
  constellationAppliesStatus?: string[];
  /** 대상이 이미 가지고 있어야 하는 상태이상 */
  enemyHasStatus?: string[];
  /** 헌터 행동이 피해를 주는 행동이어야 함 */
  hunterDealsDamage?: boolean;
}

export interface ComboEffect {
  /** 피해 증가 비율 */
  damageBonus?: number;
  /** 적 방어력 추가 무시 비율 */
  ignoreDefense?: number;
  /** 받는 피해 추가 감소 비율 */
  damageReduction?: number;
  /** 추가로 부여하는 상태이상 */
  applyStatusIds?: string[];
  /** 구조 회복량 추가 비율 */
  rescueBonus?: number;
  /** 반격 피해 (적에게) */
  counterDamage?: number;
  /** 기믹 진행 추가 */
  gimmickBonus?: number;
}

export interface ComboDefinition {
  id: string;
  label: string;
  labelKo: string;
  description: string;
  condition: ComboCondition;
  effect: ComboEffect;
  /** 위에서부터 검사해 처음 성립한 하나만 적용한다 */
  priority: number;
}

export const COMBO_DEFINITIONS: ComboDefinition[] = [
  {
    id: 'combo.star_break',
    label: 'STAR BREAK',
    labelKo: '공격 연계',
    description: '성좌가 방어를 무너뜨린 자리를 헌터가 그대로 파고든다.',
    condition: {
      constellationAppliesStatus: ['def.down', 'def.down.great', 'weak'],
      hunterDealsDamage: true,
    },
    effect: { damageBonus: 0.3, ignoreDefense: 0.2 },
    priority: 10,
  },
  {
    id: 'combo.manifest_strike',
    label: 'DESCENT EDGE',
    labelKo: '현신 연계',
    description: '헌터가 붙잡아 둔 적에게 성좌가 직접 내려온다.',
    condition: {
      constellationKinds: ['MANIFEST', 'FULL_MANIFEST'],
      hunterAppliesStatus: ['bind', 'weak', 'bleed'],
    },
    effect: { damageBonus: 0.45, applyStatusIds: ['weak'] },
    priority: 5,
  },
  {
    id: 'combo.aegis',
    label: 'AEGIS LINK',
    labelKo: '방어 연계',
    description: '헌터가 세운 방어에 성좌의 보호가 겹친다.',
    condition: {
      hunterKinds: ['DEFENSE'],
      constellationKinds: ['BUFF'],
    },
    effect: { damageReduction: 0.2, counterDamage: 6 },
    priority: 20,
  },
  {
    id: 'combo.suppress',
    label: 'SUPPRESSION',
    labelKo: '제압 연계',
    description: '성좌가 묶어 둔 적에게 헌터가 상태이상을 덧씌운다.',
    condition: {
      constellationAppliesStatus: ['bind'],
      hunterDealsDamage: true,
    },
    effect: { damageBonus: 0.2, applyStatusIds: ['bleed'] },
    priority: 15,
  },
  {
    id: 'combo.rescue',
    label: 'RECOVERY LINK',
    labelKo: '구조 연계',
    description: '성좌가 길을 열어 헌터의 구조를 돕는다.',
    condition: {
      hunterKinds: ['RESCUE'],
      constellationKinds: ['BUFF', 'REVELATION'],
    },
    effect: { rescueBonus: 0.5, applyStatusIds: ['guard.up'] },
    priority: 25,
  },
  {
    id: 'combo.gimmick',
    label: 'INSIGHT LINK',
    labelKo: '기믹 연계',
    description: '성좌의 계시가 장치의 구조를 읽어낸다.',
    condition: {
      hunterKinds: ['GIMMICK'],
      constellationKinds: ['REVELATION'],
    },
    effect: { gimmickBonus: 1 },
    priority: 30,
  },
];

export function sortedCombos(): ComboDefinition[] {
  return [...COMBO_DEFINITIONS].sort((a, b) => a.priority - b.priority);
}
