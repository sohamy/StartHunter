/**
 * 층 기믹 정의.
 *
 * 힘으로만 밀어붙이면 통과할 수 없는 조건을 만든다.
 * 헌터의 기믹 수행 행동으로 진행하고, 제한 라운드를 넘기면 실패 효과가 발생한다.
 */

export interface GimmickDefinition {
  id: string;
  label: string;
  labelKo: string;
  description: string;
  /** 필요한 누적 수행 횟수 */
  required: number;
  /** 제한 라운드. null 이면 제한 없음 */
  roundLimit: number | null;
  /** 성공 시 효과 */
  onClear: {
    /** 적에게 부여하는 상태이상 */
    applyStatusIds?: string[];
    /** 적에게 주는 고정 피해 */
    damage?: number;
    message: string;
  };
  /** 실패 시 효과 */
  onFail: {
    /** 모든 헌터가 받는 피해 */
    damageToAll?: number;
    applyStatusIds?: string[];
    message: string;
  };
}

export const GIMMICK_DEFINITIONS: GimmickDefinition[] = [
  {
    id: 'gimmick.seal',
    label: 'SEAL CORE',
    labelKo: '봉인 코어',
    description:
      '보스의 갑각을 유지하는 봉인 장치. 정해진 라운드 안에 해제하지 못하면 탑의 힘이 역류한다.',
    required: 3,
    roundLimit: 4,
    onClear: {
      applyStatusIds: ['def.down.great', 'bind'],
      damage: 40,
      message: '봉인이 해제되어 보스의 갑각이 벌어집니다.',
    },
    onFail: {
      damageToAll: 18,
      applyStatusIds: ['weak'],
      message: '봉인이 역류해 공략조 전체가 충격을 받습니다.',
    },
  },
  {
    id: 'gimmick.pillar',
    label: 'STAR PILLAR',
    labelKo: '성좌 기둥',
    description: '성좌의 문양이 새겨진 기둥. 활성화하면 권능의 흐름이 공략조 쪽으로 기운다.',
    required: 2,
    roundLimit: null,
    onClear: {
      applyStatusIds: ['weak'],
      message: '기둥이 빛나며 적의 약점이 드러납니다.',
    },
    onFail: {
      message: '기둥이 침묵합니다.',
    },
  },
];

export function findGimmick(defId: string): GimmickDefinition | null {
  return GIMMICK_DEFINITIONS.find((row) => row.id === defId) ?? null;
}

/** 기믹 수행 1회당 진행량 */
export const GIMMICK_RULES = {
  progressPerAction: 1,
} as const;
