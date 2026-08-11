/**
 * 전투 시스템 데이터 모델.
 *
 * 이 파일에는 "구조"만 둔다. 실제 수치(행동력, 피해, 부상 기준 등)는
 * 전부 `src/battle/config/` 에서 정의한다.
 *
 * 전투는 처음부터 다수 페어 · 다수 적을 담을 수 있는 형태로 둔다.
 * 1페어 vs 몬스터(DUEL)는 페어가 하나뿐인 레이드로 취급한다.
 */

export type ActorSide = 'HUNTER' | 'CONSTELLATION';

export type ActionKind =
  | 'WAIT'
  | 'ATTACK'
  | 'DEFENSE'
  | 'SKILL'
  | 'PROTECT'
  | 'RESCUE'
  | 'GIMMICK'
  | 'ITEM'
  | 'BUFF'
  | 'DEBUFF'
  | 'REVELATION'
  | 'MANIFEST'
  | 'FULL_MANIFEST';

export type TargetType = 'ENEMY' | 'SELF' | 'PAIR' | 'ALLY' | 'NONE';

/** 헌터 부상 단계 */
export type InjuryStage = 'NORMAL' | 'INJURED' | 'SEVERE' | 'CRITICAL' | 'DOWN';

/** 성좌 존재 상태 (안정 / 흔들림 / 균열 / 붕괴 직전 / 소멸) */
export type ConstellationStage = 'STABLE' | 'UNSTABLE' | 'CRACKED' | 'COLLAPSE' | 'LOST';

/** 계약 안정도 단계 */
export type ContractStage =
  | 'RESONANCE'
  | 'HEIGHTENED'
  | 'CALM'
  | 'ANXIOUS'
  | 'FRACTURED'
  | 'BROKEN';

export type Affiliation = 'GOVERNMENT' | 'PRIVATE_GUILD';

export type BattleStatus = 'PREPARING' | 'ENGAGED' | 'CLEARED' | 'FAILED';

/**
 * 전투 규모.
 * DUEL — 페어 1조 vs 몬스터
 * RAID — 다수 페어 공동 공략
 *
 * 데이터 구조는 동일하며, UI 표기와 기본 프리셋만 달라진다.
 */
export type BattleMode = 'DUEL' | 'RAID';

/**
 * 조작 주체 상태.
 * ACTIVE — 참가자가 직접 조작
 * AUTO   — 자동 행동에 위임 (페어 이탈, 부재, 응답 없음)
 */
export type ControlMode = 'ACTIVE' | 'AUTO';

/**
 * 행동이 만들어내는 효과.
 * Phase 가 올라가면 필드를 추가하되, 엔진은 존재하는 필드만 해석한다.
 */
export interface ActionEffect {
  /** 적에게 주는 피해 계수 */
  damage?: number;
  /** 이번 라운드 헌터가 받는 피해 감소 비율 (0~1) */
  damageReduction?: number;
  /** 페어 헌터의 공격력 증가 비율 (0~1) */
  attackUp?: number;
  /** 적 방어력 감소 비율 (0~1) */
  enemyDefenseDown?: number;
  /** 적의 다음 패턴 공개 */
  revealPattern?: boolean;
}

export interface ActionDefinition {
  id: string;
  side: ActorSide;
  kind: ActionKind;
  /** 콘솔 표기용 라벨 */
  label: string;
  labelKo: string;
  description: string;
  apCost: number;
  target: TargetType;
  effect: ActionEffect;
  /**
   * 이 행동이 실제로 동작하기 시작하는 구현 단계.
   * 현재 구현 단계보다 크면 UI 에 표시되지만 선택할 수 없다.
   */
  implementedIn: number;
}

export interface HunterState {
  name: string;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  /** 기본 공격력 (행동 피해 계수의 기준값) */
  attack: number;
  /** 방어력 — 받는 피해를 상수로 깎는다 */
  defense: number;
  control: ControlMode;
  /** 이 캐릭터의 시트 id. 프리셋 NPC 는 null */
  sheetId: string | null;
  /** 클래스 id (config/characters.ts) */
  classId: string | null;
}

export interface ConstellationState {
  name: string;
  ap: number;
  maxAp: number;
  stage: ConstellationStage;
  control: ControlMode;
  /** 권능 효과 배율. 1 이 기준값 */
  power: number;
  sheetId: string | null;
  /** 권역 id (config/characters.ts) */
  classId: string | null;
}

export interface ContractState {
  stage: ContractStage;
  /** 0~100. UI 게이지 표시용 */
  value: number;
}

/** 해당 라운드에 페어가 제출한 행동 */
export interface RoundSubmission {
  hunterActionId: string | null;
  constellationActionId: string | null;
  /** 공격 대상 적 */
  targetEnemyId: string | null;
  submitted: boolean;
  /** 자동 행동으로 채워진 제출인지 */
  auto: boolean;
}

export interface PairState {
  id: string;
  label: string;
  affiliation: Affiliation;
  hunter: HunterState;
  constellation: ConstellationState;
  contract: ContractState;
  /** 페어 공용 상점 화폐. 전투 중에는 조회만 한다. */
  points: number;
  submission: RoundSubmission;
  /** 계시로 다음 패턴을 확인한 상태인지 (페어 단위 정보) */
  patternRevealed: boolean;
}

export interface EnemyState {
  id: string;
  name: string;
  grade: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  phase: number;
  maxPhase: number;
  /** 상태이상 목록 (Phase 2) */
  statuses: string[];
  /** 다음 패턴 이름. 공개 전에는 UNKNOWN 으로 표시한다. */
  nextPattern: string;
  /** 보스 여부 — UI 강조와 이후 페이즈 처리에 사용 */
  boss: boolean;
}

export type LogChannel = 'SYSTEM' | 'ROLEPLAY';

export interface LogEntry {
  id: string;
  /** HH:MM:SS */
  at: string;
  channel: LogChannel;
  round: number;
  /** 관련 페어. 전체 전투 로그면 null */
  pairId: string | null;
  text: string;
  detail?: string;
}

export interface BattleState {
  schemaVersion: number;
  id: string;
  mode: BattleMode;
  operation: {
    name: string;
    floor: number;
    threatLevel: string;
  };
  round: number;
  status: BattleStatus;
  pairs: PairState[];
  enemies: EnemyState[];
  /** 이 단말에서 조작 중인 페어 */
  viewerPairId: string;
  log: LogEntry[];
}

/* ── 캐릭터 시트와 계정 ────────────────────────────────
   시트는 전투 상태(HunterState / ConstellationState)의 원본이다.
   전투가 시작되면 시트에서 파생된 값이 전투 상태로 복사된다. */

/** 스탯 키는 config 에서 정의한다. 새 스탯을 넣을 때 타입을 고치지 않도록 열어 둔다. */
export type StatBlock = Record<string, number>;

export interface CharacterSheet {
  id: string;
  side: ActorSide;
  /** 헌터의 이름 또는 성좌의 성호 */
  name: string;
  /** 헌터 클래스 또는 성좌 권역 id */
  classId: string;
  stats: StatBlock;
  /** 컨셉 · 설정 자유 서술 */
  concept: string;
  /** 헌터의 소속 진영. 성좌는 계약한 헌터를 따른다. */
  affiliation: Affiliation;
  createdAt: string;
}

/**
 * 참가자 계정.
 *
 * 서버가 없는 단계에서는 이 브라우저에만 저장된다.
 * passwordHash 는 서버 인증을 대체하지 못한다 — 시트 선택용 잠금일 뿐이다.
 */
export interface Account {
  id: string;
  passwordHash: string;
  sheet: CharacterSheet;
  createdAt: string;
}

export interface Session {
  accountId: string;
  startedAt: string;
}

export interface BattleSummary {
  id: string;
  mode: BattleMode;
  operationName: string;
  round: number;
  status: BattleStatus;
  updatedAt: string;
}

/* ── 라운드 처리 예상 결과 ─────────────────────────────────
   운영진은 APPLY 전에 이 값을 수정할 수 있어야 한다 (Phase 5).
   따라서 preview 는 계산 결과를 담기만 하고, 상태를 직접 바꾸지 않는다. */

export interface PairPreview {
  pairId: string;
  pairLabel: string;
  hunterActionId: string | null;
  constellationActionId: string | null;
  /** 자동 행동으로 채워진 항목 */
  autoFilled: ActorSide[];
  targetEnemyId: string | null;
  apSpent: { hunter: number; constellation: number };
  /** 이 페어가 적에게 주는 피해 */
  damageToEnemy: number;
  /** 이번 라운드 확보한 피해 감소 비율 */
  damageReduction: number;
  revealPattern: boolean;
  notes: string[];
  skipped: boolean;
  skipReason?: string;
}

export interface EnemyActionPreview {
  enemyId: string;
  enemyName: string;
  pattern: string;
  targetPairId: string | null;
  damageToHunter: number;
  notes: string[];
}

export interface RoundPreview {
  round: number;
  pairs: PairPreview[];
  enemies: EnemyActionPreview[];
  totals: {
    damageToEnemies: number;
    damageToHunters: number;
  };
}
