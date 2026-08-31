/**
 * 포인트 보상 규칙.
 *
 * 포인트는 행동력과 완전히 별개의 자원이며 개인 소유의 상점 화폐다.
 * 전투 화면에서는 보유량만 확인한다 — 전투 중 포인트로 행동력이나 스킬을 사기는 만들지 않는다.
 *
 * 수치는 이 파일만 고쳐서 조정한다.
 */

export type RewardReason =
  | 'FLOOR_CLEAR'
  | 'BOSS_CLEAR'
  | 'SUB_MISSION'
  | 'PAIR_RESCUE'
  | 'HIDDEN_GIMMICK'
  | 'AFFILIATION_MISSION';

export interface RewardRule {
  reason: RewardReason;
  label: string;
  labelKo: string;
  /** 고정 지급액 */
  points: number;
  /** 운영진이 범위 안에서 조절하는 항목이면 범위를 함께 둔다 */
  range?: { min: number; max: number };
  /** 자동으로 지급되는지 — false 면 운영진이 직접 지급한다 */
  automatic: boolean;
  description: string;
}

export const REWARD_RULES: RewardRule[] = [
  {
    reason: 'FLOOR_CLEAR',
    label: 'FLOOR CLEAR',
    labelKo: '일반 층 클리어',
    points: 100,
    automatic: true,
    description: '보스가 아닌 층을 통과했을 때.',
  },
  {
    reason: 'BOSS_CLEAR',
    label: 'BOSS CLEAR',
    labelKo: '보스 층 클리어',
    points: 300,
    automatic: true,
    description: '보스가 배치된 층을 통과했을 때.',
  },
  {
    reason: 'SUB_MISSION',
    label: 'SUB MISSION',
    labelKo: '서브 임무',
    points: 100,
    range: { min: 50, max: 150 },
    automatic: false,
    description: '운영진이 별도로 부여한 임무를 달성했을 때.',
  },
  {
    reason: 'PAIR_RESCUE',
    label: 'PAIR RESCUE',
    labelKo: '다른 페어 구조',
    points: 100,
    automatic: true,
    description: '전투 불능 상태의 다른 페어를 끌어냈을 때.',
  },
  {
    reason: 'HIDDEN_GIMMICK',
    label: 'HIDDEN GIMMICK',
    labelKo: '숨겨진 기믹',
    points: 80,
    automatic: true,
    description: '층 기믹을 파악하고 해제했을 때.',
  },
  {
    reason: 'AFFILIATION_MISSION',
    label: 'AFFILIATION MISSION',
    labelKo: '진영 임무',
    points: 150,
    range: { min: 100, max: 200 },
    automatic: false,
    description: '소속 진영이 따로 내린 임무를 달성했을 때.',
  },
];

export function findReward(reason: RewardReason): RewardRule {
  const rule = REWARD_RULES.find((row) => row.reason === reason);
  if (!rule) throw new Error(`보상 규칙(${reason})이 정의되어 있지 않습니다.`);
  return rule;
}

/** 운영진이 직접 지급하는 항목 목록 */
export function manualRewards(): RewardRule[] {
  return REWARD_RULES.filter((row) => !row.automatic);
}
