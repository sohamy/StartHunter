/**
 * 자동 행동 정책.
 *
 * 페어 한쪽이 이탈하거나 응답하지 않아도 남은 참가자가 계속 진행할 수 있어야 한다.
 * 조작 주체가 AUTO 이거나, 라운드 처리 시점까지 행동이 제출되지 않은 경우
 * 아래 규칙을 위에서부터 검사해 첫 번째로 조건을 만족하는 행동을 사용한다.
 *
 * 규칙을 추가·수정할 때 엔진 코드를 고칠 필요가 없어야 한다.
 */

import type { ActorSide } from '../types';

export interface AutoRuleCondition {
  /** 헌터 HP 가 이 비율(%) 미만일 때 */
  hunterHpBelowPercent?: number;
  /** 헌터 HP 가 이 비율(%) 이상일 때 */
  hunterHpAtLeastPercent?: number;
  /** 대상 적의 방어력이 이 값 이상일 때 */
  enemyDefenseAtLeast?: number;
  /** 자신의 남은 행동력이 이 값 이상일 때 */
  apAtLeast?: number;
}

export interface AutoRule {
  id: string;
  side: ActorSide;
  actionId: string;
  when?: AutoRuleCondition;
  /** 로그와 UI 에 표시할 판단 근거 */
  reason: string;
}

/**
 * 기본 정책은 "죽지 않는 것"을 우선한다.
 * 자동 행동은 현신처럼 소모가 크거나 되돌릴 수 없는 행동을 절대 고르지 않는다.
 */
export const AUTO_RULES: AutoRule[] = [
  {
    id: 'auto.hunter.guard',
    side: 'HUNTER',
    actionId: 'hunter.defend',
    when: { hunterHpBelowPercent: 40, apAtLeast: 1 },
    reason: 'HP 40% 미만 — 생존 우선 방어',
  },
  {
    id: 'auto.hunter.attack',
    side: 'HUNTER',
    actionId: 'hunter.attack',
    when: { apAtLeast: 1 },
    reason: '기본 공격 수행',
  },
  {
    id: 'auto.hunter.wait',
    side: 'HUNTER',
    actionId: 'hunter.wait',
    reason: '행동력 부족 — 대기',
  },
  {
    id: 'auto.const.debuff',
    side: 'CONSTELLATION',
    actionId: 'const.debuff',
    when: { enemyDefenseAtLeast: 1, apAtLeast: 1 },
    reason: '적 방어력 확인 — 방어력 감소 부여',
  },
  {
    id: 'auto.const.buff',
    side: 'CONSTELLATION',
    actionId: 'const.buff',
    when: { apAtLeast: 1 },
    reason: '헌터 공격 지원 버프',
  },
  {
    id: 'auto.const.wait',
    side: 'CONSTELLATION',
    actionId: 'const.wait',
    reason: '행동력 부족 — 관측',
  },
];

/** 자동 행동이 절대 선택하지 않는 행동 종류 */
export const AUTO_FORBIDDEN_KINDS = ['MANIFEST', 'FULL_MANIFEST', 'ITEM'] as const;
