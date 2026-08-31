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

/* ── 아이템 ────────────────────────────────────────────
   정의(ItemDefinition)는 config/items.ts 에 있고,
   보유 개수는 전투 상태의 인스턴스(ItemStack)가 들고 있다. */

/** 요구사항서 15장의 분류 */
export type ItemCategory =
  | 'HUNTER_ONLY'
  | 'CONSTELLATION_ONLY'
  | 'SHARED'
  | 'AFFILIATION'
  | 'KEY';

/**
 * 아이템 사용 효과.
 * 엔진은 존재하는 필드만 해석한다 — 새 필드를 넣어도 기존 아이템은 그대로 동작한다.
 */
export interface ItemEffect {
  /** 대상 헌터의 HP 를 고정값만큼 회복 */
  healHp?: number;
  /** 대상 헌터의 최대 HP 비율만큼 회복 */
  healPercent?: number;
  /** 사용한 주체의 행동력 즉시 회복 */
  restoreAp?: number;
  /** 부여하는 상태이상 정의 id */
  applyStatusIds?: string[];
  /** 이 종류의 상태이상을 제거한다 */
  cureKinds?: StatusKind[];
  /** 적에게 주는 고정 피해 (방어력을 무시한다) */
  damage?: number;
  /** 계약 안정도 회복량 */
  contractRepair?: number;
  /** 성좌 상태 단계 회복 수 */
  stageRepair?: number;
  /** 전투 불능 대상을 최대 HP 이 비율로 되살린다 */
  revivePercent?: number;
}

export interface ItemDefinition {
  id: string;
  name: string;
  nameKo: string;
  category: ItemCategory;
  description: string;
  target: TargetType;
  apCost: number;
  /** 전투 중 사용 가능 여부 */
  combatUsable: boolean;
  /** AFFILIATION 분류일 때 어느 진영 것인지 */
  affiliation?: Affiliation;
  effect: ItemEffect;
}

/**
 * 운영진이 작전실에서 정한 상점 진열 한 줄.
 *
 * 기본 목록(config/shop.ts 의 SHOP_ENTRIES)에 얹는다 —
 * 같은 itemId 면 가격 · 한도를 덮어쓰고, active 가 false 면 진열에서 빠지며,
 * 기본 목록에 없는 itemId 면 새 품목으로 붙는다.
 */
export interface ShopItemRecord {
  itemId: string;
  price: number;
  /** 한 페어가 보유할 수 있는 최대 개수. null 이면 제한 없음 */
  limit: number | null;
  active: boolean;
  /** 진열 순서. 작을수록 앞 */
  sort: number;
  /** 운영진이 새로 만든 품목이면 정의가 함께 온다. 기본 품목의 값만 고쳤으면 null */
  item: ItemDefinition | null;
}

/** 보유 아이템 — 페어 공용 가방에 담긴다 */
export interface ItemStack {
  itemId: string;
  quantity: number;
}

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
  /** 대상 헌터의 최대 HP 이 비율만큼 회복 */
  heal?: number;
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
  /** 시트 스탯 사본 — 기믹 판정처럼 스탯을 직접 쓰는 계산에 필요하다 */
  stats: StatBlock;
  /**
   * 전투 불능 저항(의지)을 이미 소진했는지.
   * 한 전투에 한 번만 버틸 수 있으므로 상태로 남긴다.
   */
  lastStandUsed: boolean;
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
  /** 시트 스탯 사본 — 기믹 판정처럼 스탯을 직접 쓰는 계산에 필요하다 */
  stats: StatBlock;
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
  /**
   * 기믹 수행 선언.
   * 장치를 어떻게 다루는지 참가자가 직접 서술해야 하며, 채팅에 공개되고
   * 관리국이 판정한다. 서술 없는 기믹 수행은 진행으로 인정되지 않는다.
   */
  gimmickNote: string | null;
  /** 기믹 시도 단계 — 파악 전에는 해결을 시도할 수 없다 */
  gimmickStage: GimmickStage | null;
  /** 확정 시점에 굴린 판정. 채팅에도 공개된다 */
  gimmickCheck: GimmickCheck | null;
  /** 헌터가 아이템 행동으로 쓰려는 아이템 (config/items.ts) */
  hunterItemId: string | null;
  /** 성좌가 성유물 행동으로 쓰려는 아이템 */
  constellationItemId: string | null;
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
  /** 페어 공용 가방. 사용하면 개수가 줄어든다. */
  inventory: ItemStack[];
  submission: RoundSubmission;
  /** 계시로 다음 패턴을 확인한 상태인지 (페어 단위 정보) */
  patternRevealed: boolean;
}

/* ── 커스텀 공격 ───────────────────────────────────────
   운영진이 공격을 하나하나 만들어 적의 패턴으로 쓴다.
   페이즈별로 목록을 두면 라운드마다 순서대로 돌아간다.
   커스텀 공격이 하나라도 있으면 config/patterns.ts 의 패턴 세트는 쓰지 않는다. */

export interface CustomAttack {
  id: string;
  /** 표기 이름 — 로그와 예고에 그대로 나간다 */
  name: string;
  /** 연출 문구 */
  description: string;
  /** 적 공격력에 곱하는 계수. 0 이면 피해 없이 연출 · 상태이상만 */
  powerRatio: number;
  /** 살아 있는 모든 페어를 때린다 */
  aoe: boolean;
  /** 맞은 쪽에게 부여하는 상태이상 정의 id */
  applyStatusIds: string[];
  /** 자신에게 부여하는 상태이상 (분노 등) */
  selfStatusIds: string[];
  /** 참가자에게 이름을 미리 공개하는지 */
  revealed: boolean;
  /** 예고 라운드. 0 이면 즉시, 1 이상이면 그만큼 예고한 뒤 발동한다 */
  telegraphRounds: number;
  /** 예고 문구 */
  telegraphMessage: string;
  /** 이 공격을 쓰는 페이즈 목록. 비어 있으면 모든 페이즈 */
  phases: number[];
  /**
   * 라운드 주기 — 2 이상이면 `라운드 % every === offset` 인 라운드에만 쓴다.
   * 0 · 1 이면 주기 조건이 없다는 뜻이고, 조건 없는 공격끼리 순서대로 돌아간다.
   */
  every?: number;
  /** 주기 안에서의 자리. every 3 · offset 1 이면 1 · 4 · 7 라운드 */
  offset?: number;
  /** 적 HP 비율(%)이 이 값 이하일 때만 쓴다. null · 미지정이면 조건 없음 */
  hpBelowPercent?: number | null;
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
  /** 이 적의 커스텀 공격. 있으면 패턴 세트보다 우선한다 */
  attacks: CustomAttack[];
  /** 다음 패턴 이름. 공개 전에는 UNKNOWN 으로 표시한다. */
  nextPattern: string;
  /** 보스 여부 — UI 강조와 페이즈 처리에 사용 */
  boss: boolean;
  /** 이 적이 쓰는 패턴 세트 id (config/patterns.ts) */
  patternSetId: string | null;
  /**
   * 페이즈가 넘어가는 HP 비율(%) 경계. 내림차순으로 두고, 길이는 페이즈 수 - 1 이다.
   * [70, 30] 이면 HP 70% 이상 PHASE 1, 30% 이상 PHASE 2, 그 아래 PHASE 3.
   * 비어 있으면 패턴 세트의 경계를 쓰고, 그것도 없으면 페이즈 수만큼 균등 분할한다.
   */
  phaseCutoffs?: number[];
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
  /** 파악 완료 여부 — 파악 전에는 해결을 시도할 수 없다 */
  identified: boolean;
  /** 파악에 성공한 페어 */
  identifiedBy: string[];
}

/** 기믹 시도 단계 */
export type GimmickStage = 'INSIGHT' | 'RESOLVE';

/** 기믹 판정 기록 */
export interface GimmickCheck {
  stage: GimmickStage;
  expression: string;
  rolls: number[];
  /** 스탯에서 온 보정 */
  bonus: number;
  /** 보정 내역 — 화면과 채팅에 그대로 노출한다 */
  breakdown: string[];
  total: number;
  dc: number;
  success: boolean;
  critical: boolean;
  /** 선언이 걸린 접근. null 이면 인정되는 접근이 아니었다는 뜻 */
  approachId?: string | null;
  approachLabel?: string | null;
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
  /**
   * 지급된 포인트 내역.
   * 페어의 `points` 는 합계일 뿐이므로, 무엇으로 얼마를 받았는지는 이 원장에 남긴다 —
   * 전투 종료 후 정산과 공략 기록이 이 값을 근거로 쓴다.
   */
  rewards: RewardEntry[];
}

export interface RewardEntry {
  id: string;
  round: number;
  pairId: string;
  /** config/rewards.ts 의 RewardReason 또는 운영진 수동 지급 사유 */
  reason: string;
  label: string;
  points: number;
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

/**
 * 컨셉 서술.
 *
 * 한 칸짜리 자유 서술은 무엇을 적어야 할지 알기 어려워 세 칸으로 나눈다.
 * 칸마다의 안내 문구와 글자 수 상한은 config/characters.ts 의 PROFILE_FIELDS 가 정한다.
 */
export interface SheetProfile {
  /** 성격 */
  personality: string;
  /** 특징 — 좋아하는 것 · 싫어하는 것 · 생일 등 */
  traits: string;
  /** 성좌와 계약을 맺은 경위. 공란일 수 있다. */
  contractStory: string;
}

export type ProfileFieldKey = keyof SheetProfile;



export interface CharacterSheet extends SheetProfile {
  id: string;
  side: ActorSide;
  /** 헌터의 이름 또는 성좌의 성호 */
  name: string;
  /**
   * 페어 이름 — 두 사람이 함께 쓰는 조 이름.
   * 참가자가 직접 적는 칸이다. 정하지 않았으면 공란으로 둔다.
   * 관리국이 편성을 확정하면 화면은 편성 라벨(PAIR 01 …)을 함께 보여 준다.
   */
  pairName: string;
  /**
   * 계약 상대(페어)의 이름.
   * 참가자가 직접 적는 칸이다 — 아직 상대가 없으면 공란으로 둔다.
   * 관리국이 편성(PairBond)을 확정하면 화면은 편성 쪽 이름을 우선해 보여 준다.
   */
  partnerName: string;
  /** 헌터 클래스 또는 성좌 권역 id */
  classId: string;
  stats: StatBlock;
  /** 캐릭터별 커스텀 스킬 */
  skills: SkillDefinition[];
  /**
   * 소지금. **개인 소유**다 — 페어와 나누지 않는다.
   * 지급 · 차감은 관리국이 하고, 참가자는 상점에서 쓴다.
   */
  points: number;
  /** 개인 가방. 전투에 들어갈 때 페어의 가방으로 합쳐진다. */
  inventory: ItemStack[];
  /**
   * 캐릭터 사진 — 정사각 축소본 data URL.
   * 없을 수 있다. 규칙은 config/rules.ts 의 PORTRAIT_RULES 에 있다.
   */
  portrait?: string | null;
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
  /**
   * @deprecated 포인트와 보급품은 개인(CharacterSheet) 소유로 옮겼다.
   * 옛 편성 자료를 읽기 위해 남겨 둔다 — 새 값은 여기에 쓰지 않는다.
   */
  points?: number;
  /** @deprecated 개인 가방(CharacterSheet.inventory)을 쓴다 */
  inventory?: ItemStack[];
}

/* ── 공략 기록 ──────────────────────────────────────────
   끝난 전투는 상태에서 지우지 않고 기록으로 보관한다.
   운영진이 나중에 결과를 확인하고 포인트를 정산하는 근거가 된다. */

export interface BattleRecordPair {
  pairId: string;
  label: string;
  hunterName: string;
  constellationName: string;
  affiliation: Affiliation;
  hunterHp: number;
  hunterMaxHp: number;
  injury: InjuryStage;
  constellationStage: ConstellationStage;
  contract: ContractState;
  /** 이 전투에서 얻은 포인트 */
  pointsEarned: number;
  /** 전투 종료 시점의 보유 포인트 */
  pointsTotal: number;
  inventory: ItemStack[];
}

export interface BattleRecord {
  id: string;
  schemaVersion: number;
  battleId: string;
  mode: BattleMode;
  operation: { name: string; floor: number; threatLevel: string };
  status: BattleStatus;
  rounds: number;
  /** ISO 문자열 */
  finishedAt: string;
  bossName: string | null;
  /** 기믹 결과 */
  gimmick: { label: string; status: GimmickState['status'] } | null;
  pairs: BattleRecordPair[];
  /** 보관 시점의 전투 로그 사본 */
  log: LogEntry[];
  /** 운영진 메모 */
  note: string;
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
  /** config/patterns.ts 의 패턴 세트. 커스텀 공격이 있으면 무시된다 */
  patternSetId: string | null;
  /** 운영진이 만든 공격 목록 */
  attacks: CustomAttack[];
  /** 페이즈 전환 HP 비율(%) 경계 — EnemyState.phaseCutoffs 와 같은 규칙 */
  phaseCutoffs?: number[];
  boss: boolean;
}

/* ── 채팅 ───────────────────────────────────────────────
   참가자와 운영자가 함께 보는 대화창. 전투 단위 채널을 쓰고,
   전투 밖에서는 'GLOBAL' 채널을 쓴다. */

export type ChatKind = 'TALK' | 'ACTION' | 'OOC' | 'ROLL';

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
  /** 다이스 결과 — kind 가 ROLL 일 때 채워진다 */
  dice: {
    expression: string;
    rolls: number[];
    modifier: number;
    total: number;
    /** 기믹 판정처럼 목표치가 있는 굴림 */
    dc?: number;
    success?: boolean;
    label?: string;
  } | null;
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
  /**
   * 정의 지속시간에 더해지는 라운드 수.
   * 권역 특성(재앙)이 늘리고, 헌터의 의지 저항이 깎는다. 음수일 수 있다.
   */
  durationBonus?: number;
}

/**
 * 아이템 사용 예정 · 결과.
 *
 * 예상 결과(preview)와 적용(apply)이 같은 값을 보게 하려고
 * 표시용 문장과 계산된 수치를 한 덩어리로 들고 다닌다.
 */
export interface ItemUse {
  side: ActorSide;
  itemId: string;
  itemName: string;
  /** 회복 · 부활 대상 페어. 자신이면 자기 페어 id */
  targetPairId: string | null;
  targetEnemyId: string | null;
  /** 사람이 읽는 결과 요약 */
  effects: string[];
  /** 대상 헌터가 되찾는 HP */
  healAmount: number;
  /** 전투 불능에서 되살리는 것인지 */
  revive: boolean;
  /** 적에게 직접 들어가는 피해 (방어력을 무시한다) */
  damage: number;
  /** 부여하는 상태이상 정의 id */
  applyStatusIds: string[];
  /** 사용한 주체에게서 지워지는 상태이상 정의 id */
  cureStatusIds: string[];
  /** 사용한 주체가 되찾는 행동력 */
  restoreAp: number;
  contractRepair: number;
  /** 성좌 상태를 되돌리는 단계 수 */
  stageRepair: number;
  apCost: number;
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
  /** 회복 스킬 · 아이템으로 대상 페어 헌터가 되찾는 HP */
  heals: Array<{ targetPairId: string; targetLabel: string; amount: number; sourceLabel: string }>;
  /** 이번 라운드 사용하는 아이템 */
  itemUses: ItemUse[];
  /** 아이템으로 적에게 직접 들어가는 피해 (방어력 무시) */
  itemDamageToEnemy: number;
  /** 계약 안정도 변화량 — 공명 회복과 현신 반동이 합산된다 */
  contractDelta: number;
  /**
   * 성좌 상태가 움직이는 단계 수.
   * 양수는 하락(계약 붕괴 · 현신 반동), 음수는 회복(성유물)이다.
   */
  stageDrop: number;
  /** 이 페어가 이번 라운드에 얻는 포인트 */
  rewards: Array<{ reason: string; label: string; points: number }>;
  /** 기믹 수행 진행량 — 관리국이 판정 단계에서 수정한다 */
  gimmickProgress: number;
  /** 기믹 수행 선언문 — 판정 근거 */
  gimmickNote: string | null;
  /** 기믹 판정 결과 */
  gimmickCheck: GimmickCheck | null;
  /** 이 라운드에 파악이 성립하는지 */
  gimmickIdentified: boolean;
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
  /**
   * 계시가 공략조 전체에 공유되는지 (예지 권역 특성).
   * 참이면 계시를 내린 페어뿐 아니라 모든 페어가 다음 패턴을 본다.
   */
  sharedReveal: boolean;
  /** 이번 라운드 처리로 발생하는 경보 */
  alerts: Array<{ level: AlertLevel; title: string; message: string }>;
  totals: {
    damageToEnemies: number;
    damageToHunters: number;
  };
}
