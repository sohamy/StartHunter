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

  /**
   * 인정되는 접근에 걸리지 않은 선언에 붙는 보정.
   *
   * 장치마다 "무엇을 해야 풀리는지" 가 정해져 있다.
   * 엉뚱한 방법도 굴릴 수는 있지만 불리하게 굴린다 — 막지는 않는다.
   */
  offApproachPenalty: -3,
} as const;

/** config 는 types 를 참조하지 않는다 — 같은 값을 여기서 좁혀 쓴다 */
export type GimmickStageKey = 'INSIGHT' | 'RESOLVE';

/**
 * 기믹을 푸는 방법.
 *
 * 아무 말이나 적고 주사위에 기대는 것을 막기 위해,
 * 장치마다 인정되는 접근을 미리 정해 둔다.
 * 선언에 keywords 중 하나라도 들어가면 그 접근으로 인정하고 bonus 를 준다.
 *
 * 최종 인정은 언제나 관리국이 한다 — 이 값은 판정에 붙는 제안일 뿐이다.
 */
export interface GimmickApproach {
  id: string;
  /** 어느 단계에서 인정되는가 */
  stage: GimmickStageKey;
  /** 참가자에게 보이는 이름 */
  label: string;
  /** 파악이 끝난 뒤에 공개되는 구체 지시 */
  detail: string;
  /** 선언에서 찾는 낱말 — 하나라도 걸리면 인정 */
  keywords: string[];
  /** 판정에 더해지는 보정 */
  bonus: number;
}

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
  /**
   * 인정되는 접근.
   * 파악 단계는 "어떻게 살펴보는가", 해결 단계는 "어떻게 처리하는가" 를 정한다.
   */
  approaches: GimmickApproach[];
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
    approaches: [
      {
        id: 'seal.insight.trace',
        stage: 'INSIGHT',
        label: '문양을 훑어 배열을 읽는다',
        detail: '손끝이나 시선으로 새겨진 홈을 따라가며 반복되는 배열을 찾는다.',
        keywords: ['문양', '홈', '배열', '무늬', '각인', '새겨', '읽', '훑'],
        bonus: 2,
      },
      {
        id: 'seal.insight.listen',
        stage: 'INSIGHT',
        label: '울림으로 안쪽 구조를 잡는다',
        detail: '두드리거나 귀를 대어 안쪽이 빈 자리를 찾아낸다.',
        keywords: ['소리', '울림', '진동', '두드', '귀', '들'],
        bonus: 1,
      },
      {
        id: 'seal.resolve.cut',
        stage: 'RESOLVE',
        label: '고정점을 순서대로 끊는다',
        detail: '갑각과 이어진 세 고정점을, 파악한 순서 그대로 베어 낸다. 순서를 어기면 되감긴다.',
        keywords: ['고정점', '끊', '베', '절단', '자르', '참격', '검', '순서'],
        bonus: 2,
      },
      {
        id: 'seal.resolve.overwrite',
        stage: 'RESOLVE',
        label: '권능으로 문양을 덧쓴다',
        detail: '성좌의 권능을 빌려 봉인 문양 위에 다른 이름을 겹쳐 새긴다.',
        keywords: ['권능', '문양', '덧', '겹쳐', '새기', '이름', '성좌'],
        bonus: 1,
      },
    ],
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
    approaches: [
      {
        id: 'pillar.insight.touch',
        stage: 'INSIGHT',
        label: '표면에 손을 대고 흐름을 읽는다',
        detail: '맨손으로 기둥을 짚어 안쪽을 지나는 힘의 방향을 느낀다.',
        keywords: ['손', '접촉', '만지', '짚', '대'],
        bonus: 2,
      },
      {
        id: 'pillar.insight.count',
        stage: 'INSIGHT',
        label: '진동 주기를 센다',
        detail: '떨림이 반복되는 간격을 세어 통로가 열리는 순간을 잡는다.',
        keywords: ['진동', '주기', '떨림', '간격', '세', '헤아', '관찰'],
        bonus: 1,
      },
      {
        id: 'pillar.resolve.redirect',
        stage: 'RESOLVE',
        label: '흐름의 방향을 돌린다',
        detail: '통로를 지나는 권능의 방향을 공략조 쪽으로 비틀어 놓는다.',
        keywords: ['방향', '돌리', '틀', '비틀', '흐름', '역류', '돌려'],
        bonus: 2,
      },
      {
        id: 'pillar.resolve.anchor',
        stage: 'RESOLVE',
        label: '자기 계약을 기둥에 묶는다',
        detail: '자신과 성좌를 잇는 계약선을 기둥에 걸어 통로를 붙잡아 둔다.',
        keywords: ['계약', '묶', '연결', '잇', '고정', '걸'],
        bonus: 1,
      },
    ],
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
