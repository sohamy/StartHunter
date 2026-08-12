/**
 * 층 기믹 정의.
 *
 * 힘으로만 밀어붙이면 통과할 수 없는 조건을 만든다.
 * 헌터의 기믹 수행 행동으로 진행하고, 제한 라운드를 넘기면 실패 효과가 발생한다.
 */

/**
 * 기믹 판정 규칙.
 *
 * 기믹은 두 단계다.
 *   1) 파악 — 장치가 무엇인지 알아낸다. 관찰력(SEN)과 성좌의 관측(OBS)이 붙는다.
 *   2) 해결 — 파악된 장치를 실제로 처리한다. 운(LUK)과 관찰력 절반이 붙는다.
 *
 * 어느 단계든 참가자가 **어떻게 하는지 직접 서술**해야 하고, 그 선언은 채팅에 공개된다.
 * 판정 결과도 채팅에 남으며, 최종 인정 여부는 관리국이 정한다.
 */
export const GIMMICK_CHECK = {
  /** 판정에 쓰는 주사위 */
  dice: '1d20',
  /** 선언 없이 시도하면 판정하지 않는다 */
  requireDeclaration: true,
  declarationMinLength: 8,

  insight: {
    /** 헌터 주 스탯 — 1점당 +1 */
    stat: 'sen',
    statWeight: 1,
    /** 성좌 지원 스탯 — 2점당 +1 */
    supportStat: 'observation',
    supportWeight: 0.5,
  },
  resolve: {
    stat: 'luk',
    statWeight: 1,
    /** 해결에도 관찰력이 절반 붙는다 */
    secondStat: 'sen',
    secondWeight: 0.5,
    supportStat: 'observation',
    supportWeight: 0.25,
  },

  /** 해결 성공 시 진행량 */
  progressOnSuccess: 1,
  /** 주사위 최대치(대성공) 시 진행량 */
  progressOnCritical: 2,
} as const;

export interface GimmickDefinition {
  id: string;
  label: string;
  labelKo: string;
  description: string;
  /** 파악하기 전에는 이 설명만 보인다 */
  unknownDescription: string;
  /** 파악에 성공하면 공개되는 정보 */
  insightReveal: string;
  /** 파악 판정 목표치 */
  insightDc: number;
  /** 해결 판정 목표치 */
  resolveDc: number;
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
    unknownDescription:
      '벽면에 박힌 정체 불명의 구조물. 성좌의 문양 같은 것이 새겨져 있지만 읽을 수 없다.',
    insightReveal:
      '세 개의 고정점이 보스의 갑각과 연결되어 있다. 순서대로 끊어내면 갑각이 벌어진다.',
    insightDc: 12,
    resolveDc: 13,
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
    unknownDescription: '천장까지 뻗은 검은 기둥. 표면이 미세하게 진동하고 있다.',
    insightReveal: '기둥은 성좌의 권능을 흘려보내는 통로다. 접촉해 방향을 돌릴 수 있다.',
    insightDc: 10,
    resolveDc: 11,
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

/** 기믹 수행 1회당 진행량 (판정 없이 인정할 때의 기본값) */
export const GIMMICK_RULES = {
  progressPerAction: 1,
} as const;
