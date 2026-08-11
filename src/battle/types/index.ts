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
  | 'HEAL'
  | 'UTILITY'
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

/* ── 상태이상 ──────────────────────────────────────────
   정의(StatusDefinition)는 config/status.ts 에 있고,
   전투 중에는 인스턴스(StatusEffect)만 상태에 저장한다. */

export type StatusKind = 'BUFF' | 'DEBUFF' | 'DOT' | 'CONTROL';

/** 상태이상을 지닐 수 있는 주체 */
export type StatusHolder = 'HUNTER' | 'CONSTELLATION' | 'ENEMY';

export interface StatusEffect {
  /** config/status.ts 의 정의 id */
  defId: string;
  remainingRounds: number;
  stacks: number;
  /** 누가 걸었는지 — 로그 표기용 */
  sourceLabel: string;
  /**
   * 정의 수치에 곱할 배율.
   * 성좌가 건 상태이상은 권능 배율과 성좌 상태 보정이 여기에 담긴다.
   * 생략하면 1 로 본다.
   */
  scale?: number;
}

/* ── 스킬 ──────────────────────────────────────────────
   캐릭터마다 다른 커스텀 스킬을 전제로 한다.
   정의는 시트에 저장되고, 전투가 시작되면 런타임 상태가 붙는다. */

export type SkillKind =
  | 'ATTACK'
  | 'DEFENSE'
  | 'BUFF'
  | 'DEBUFF'
  | 'HEAL'
  | 'UTILITY'
  | 'MANIFESTATION';

export interface SkillDefinition {
  id: string;
  side: ActorSide;
  kind: SkillKind;
  name: string;
  description: string;
  apCost: number;
  target: TargetType;
  /** 기본 수치 — 공격 계수 또는 효과 비율의 기준값 */
  power: number;
  /** 사용 후 재사용까지 필요한 라운드 수. 0 이면 쿨타임 없음 */
  cooldown: number;
  /** 전투당 사용 횟수. null 이면 무제한 */
  maxUses: number | null;
  /** 부여하는 상태이상 정의 id */
  applyStatusIds: string[];
  /** 수치로 표현되지 않는 특수 효과 — 운영진 판정용 서술 */
  special: string;
}

/** 전투 중의 스킬 — 정의 스냅샷 + 쿨타임/사용 횟수 */
export interface SkillRuntime extends SkillDefinition {
  currentCooldown: number;
  remainingUses: number | null;
}

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
  /** 부여하는 상태이상 정의 id */
  applyStatusIds?: string[];
  /** 상태이상을 누구에게 거는지. 생략하면 정의의 appliesTo 를 따른다 */
  statusHolder?: StatusHolder;
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
  statuses: StatusEffect[];
  skills: SkillRuntime[];
}

/** 현신 남은 사용 횟수. null 은 무제한 */
export interface ManifestUses {
  partial: number | null;
  full: number | null;
}

export interface ConstellationState {
  name: string;
  ap: number;
  maxAp: number;
  stage: ConstellationStage;
  control: ControlMode;
  manifestUses: ManifestUses;
  /** 권능 효과 배율. 1 이 기준값 */
  power: number;
  sheetId: string | null;
  /** 권역 id (config/characters.ts) */
  classId: string | null;
  statuses: StatusEffect[];
  skills: SkillRuntime[];
}

export interface ContractState {
  stage: ContractStage;
  /** 0~100. UI 게이지 표시용 */
  value: number;
}

/**
 * 해당 라운드에 페어가 제출한 행동.
 *
 * 헌터와 성좌는 **서로 다른 참가자**다. 각자 자기 쪽만 제출한다.
 * 한 사람이 양쪽을 조작하는 구조가 아니므로 제출 플래그도 쪽별로 나눈다.
 */
export interface RoundSubmission {
  hunterActionId: string | null;
  constellationActionId: string | null;
  /** 공격 대상 적 (헌터가 지정) */
  targetEnemyId: string | null;
  /** 구조 · 보호 행동의 대상 페어 (헌터가 지정) */
  supportTargetPairId: string | null;
  hunterSubmitted: boolean;
  constellationSubmitted: boolean;
}

export interface PairState {
  id: string;
  label: string;
  affiliation: Affiliation;
  /** 헌터를 조작하는 계정 */
  hunterAccountId: string | null;
  /** 성좌를 조작하는 계정. 헌터와 같을 수 없다. */
  constellationAccountId: string | null;
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
  statuses: StatusEffect[];
  /** 다음 패턴 이름. 공개 전에는 UNKNOWN 으로 표시한다. */
  nextPattern: string;
  /** 보스 여부 — UI 강조와 페이즈 처리에 사용 */
  boss: boolean;
  /** 이 적이 쓰는 패턴 세트 id (config/patterns.ts) */
  patternSetId: string | null;
  /** 예고 중인 패턴 — 발동까지 남은 라운드 */
  telegraph: {
    patternId: string;
    label: string;
    message: string;
    roundsLeft: number;
  } | null;
}

/* ── 층 기믹 ───────────────────────────────────────────
   기믹은 전투 단위로 하나 존재하며, 헌터의 기믹 수행 행동으로 진행한다. */

export interface GimmickState {
  defId: string;
  label: string;
  labelKo: string;
  description: string;
  /** 필요한 누적 수행 횟수 */
  required: number;
  progress: number;
  /** 남은 라운드. null 이면 제한 없음 */
  roundsLeft: number | null;
  status: 'ACTIVE' | 'CLEARED' | 'FAILED';
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
  /** 운영진이 수정한 항목 */
  edited?: boolean;
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
  /** 현재 층의 기믹. 없으면 null */
  gimmick: GimmickState | null;
  /** 이 단말에서 조작 중인 페어 */
  viewerPairId: string;
  log: LogEntry[];
  /** 화면 전체 경보 — 최근 항목만 유지한다 */
  alerts: BattleAlert[];
}

export type AlertLevel = 'WARNING' | 'CRITICAL' | 'EMERGENCY' | 'TOWER';

export interface BattleAlert {
  id: string;
  level: AlertLevel;
  title: string;
  message: string;
  round: number;
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
  /** 캐릭터별 커스텀 스킬 */
  skills: SkillDefinition[];
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

/* ── 영구 편성 ──────────────────────────────────────────
   페어는 한 번 맺으면 공략 내내 유지된다. 전투마다 다시 짝을 짓지 않는다.
   전투는 "등록된 페어 중 누가 참가하는가"만 고른다. */

export interface PairBond {
  id: string;
  label: string;
  hunterAccountId: string | null;
  constellationAccountId: string | null;
  hunterName: string;
  constellationName: string;
  affiliation: Affiliation;
  /** 해산된 페어는 false — 기록은 남기고 편성에서만 제외한다 */
  active: boolean;
  createdAt: string;
}

/* ── 적 세팅 ────────────────────────────────────────────
   운영진이 층별로 적을 구성한다. 템플릿을 만들어 두고 전투에 배치한다. */

export interface EnemyTemplate {
  id: string;
  name: string;
  grade: string;
  maxHp: number;
  attack: number;
  defense: number;
  maxPhase: number;
  /** config/patterns.ts 의 패턴 세트 */
  patternSetId: string | null;
  boss: boolean;
}

/* ── 채팅 ───────────────────────────────────────────────
   참가자와 운영자가 함께 보는 대화창. 전투 단위 채널을 쓰고,
   전투 밖에서는 'GLOBAL' 채널을 쓴다. */

export type ChatKind = 'TALK' | 'ACTION' | 'OOC';

export interface ChatMessage {
  id: string;
  /** 전투 id 또는 'GLOBAL' */
  channel: string;
  /** 작성자 활동명 */
  authorId: string;
  /** 표시 이름 — 캐릭터명 또는 운영진 표기 */
  authorName: string;
  role: 'PARTICIPANT' | 'OPERATOR';
  side: ActorSide | null;
  kind: ChatKind;
  body: string;
  /** ISO 문자열 */
  at: string;
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

/** 상태이상 부여 예정 항목 */
export interface StatusApplication {
  holder: StatusHolder;
  /** 대상 페어 id 또는 적 id */
  ownerId: string;
  defId: string;
  label: string;
  /** 부여 시점의 효과 배율 (권능 배율 등) */
  scale: number;
}

/** 성립한 연계의 표시용 정보 */
export interface ComboResultView {
  id: string;
  label: string;
  labelKo: string;
  description: string;
  effects: string[];
}

/** 라운드 종료 시 상태이상이 주는 고정 피해 */
export interface StatusTick {
  holder: StatusHolder;
  ownerId: string;
  ownerLabel: string;
  defId: string;
  label: string;
  amount: number;
}

export interface PairPreview {
  pairId: string;
  pairLabel: string;
  hunterActionId: string | null;
  hunterActionLabel: string;
  constellationActionId: string | null;
  constellationActionLabel: string;
  /** 이번 라운드 사용한 스킬 (쿨타임 · 사용 횟수 차감 대상) */
  usedSkills: Array<{ side: ActorSide; skillId: string }>;
  /** 이번 라운드 부여되는 상태이상 */
  appliedStatuses: StatusApplication[];
  /** 성립한 페어 연계 */
  combo: ComboResultView | null;
  /** 구조 행동 결과 */
  rescue: { targetPairId: string; targetLabel: string; restoredHp: number } | null;
  /** 기믹 수행 진행량 */
  gimmickProgress: number;
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
  patternId: string | null;
  /** 광역 공격이면 모든 페어가 대상이 된다 */
  aoe: boolean;
  /** 대상별 피해 */
  hits: Array<{ pairId: string; pairLabel: string; damage: number }>;
  /** 단일 대상 표기용 — 광역이면 null */
  targetPairId: string | null;
  damageToHunter: number;
  /** 부여하는 상태이상 */
  appliedStatuses: StatusApplication[];
  /** 상태이상으로 행동이 막혔는지 */
  blocked: boolean;
  /** 이번 라운드에 새로 예고되는 패턴 */
  telegraph: { patternId: string; label: string; message: string; roundsLeft: number } | null;
  notes: string[];
}

export interface RoundPreview {
  round: number;
  pairs: PairPreview[];
  enemies: EnemyActionPreview[];
  /** 라운드 종료 시 처리되는 지속 피해 */
  statusTicks: StatusTick[];
  /** 기믹 진행 예상 */
  gimmick: { progress: number; required: number; willClear: boolean; willFail: boolean } | null;
  /** 이번 라운드 처리로 발생하는 경보 */
  alerts: Array<{ level: AlertLevel; title: string; message: string }>;
  totals: {
    damageToEnemies: number;
    damageToHunters: number;
  };
}
