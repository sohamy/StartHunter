/**
 * 저장 계층 인터페이스.
 *
 * UI 와 엔진은 이 인터페이스만 참조한다. LocalStorage API 를 직접 호출하지 않는다.
 * 추후 Supabase 어댑터를 추가할 때 이 파일만 구현하면 된다.
 *
 * 모든 메서드는 동기 구현이어도 Promise 를 돌려준다 —
 * 네트워크 기반으로 바뀌어도 호출부를 수정하지 않기 위한 것이다.
 */

import type {
  BattleRecord,
  BattleState,
  BattleSummary,
  ChatMessage,
  EnemyTemplate,
  RouletteWheel,
  ShopItemRecord,
  PairBond,
} from '../types';

/**
 * 공개 편성 한 줄 — 누가 누구와 짝인지.
 *
 * PairBond 와 달리 비로그인도 읽는다 (0020 · public_pairs). 활성 편성만 담고,
 * 옛 공용 지갑 칸은 담지 않는다 — 소지금과 가방은 사람마다 따로다.
 */
export interface PublicPair {
  id: string;
  label: string;
  /** 활동명. 편성 한쪽이 아직 비어 있을 수 있다 */
  hunterHandle: string | null;
  constellationHandle: string | null;
  hunterName: string;
  constellationName: string;
  affiliation: PairBond['affiliation'];
  createdAt: string;
}

/**
 * 공개 전투 기록 한 건 — **로그인하지 않아도** 읽힌다 (0023 · public_records).
 *
 * 원본(BattleRecord)에서 골라 담은 것이다. 소지금 잔액 · 가방 · 운영진 메모 ·
 * 시스템 로그는 담기지 않는다 — 남의 지갑은 공개할 것이 아니고, 시스템 로그는
 * 판정 내부다. 「얻은 포인트」는 그 판의 성적이라 담는다.
 */
export interface PublicRecordPair {
  pairId: string;
  label: string;
  hunterName: string;
  constellationName: string;
  affiliation: PairBond['affiliation'];
  hunterHp: number;
  hunterMaxHp: number;
  injury: string;
  constellationStage: string;
  contract: { stage: string; value: number };
  pointsEarned: number;
}

export interface PublicRecord {
  id: string;
  mode: string;
  operation: { name: string; floor: number; threatLevel: string };
  status: 'CLEARED' | 'FAILED';
  rounds: number;
  finishedAt: string;
  bossName: string | null;
  gimmick: { label: string; status: string } | null;
  pairs: PublicRecordPair[];
  /** 연출 로그만 */
  log: Array<{ id: string; at: string; text: string }>;
}

export interface StorageAdapter {
  loadBattle(id: string): Promise<BattleState | null>;
  saveBattle(state: BattleState): Promise<void>;
  listBattles(): Promise<BattleSummary[]>;
  deleteBattle(id: string): Promise<void>;

  /* ── 영구 편성 ── */
  listBonds(): Promise<PairBond[]>;
  /**
   * 공개 편성 — 명부 게시판이 쓴다. **로그인하지 않아도** 읽힌다.
   * listBonds 는 로그인한 사람에게만 열리므로, 누구나 보는 화면은 이쪽을 쓴다.
   */
  listPublicPairs(): Promise<PublicPair[]>;
  saveBond(bond: PairBond): Promise<void>;
  deleteBond(id: string): Promise<void>;

  /* ── 적 세팅 ── */
  listEnemyTemplates(): Promise<EnemyTemplate[]>;
  saveEnemyTemplate(template: EnemyTemplate): Promise<void>;
  deleteEnemyTemplate(id: string): Promise<void>;

  /*
     상점 진열과 원반은 여기 없다 — ShopCatalog · RouletteCatalog 로 갔다.
     구현은 여전히 이 클래스가 하지만(세계 데이터라 같은 저장소에 산다),
     화면은 ports/ShopPort · ports/RoulettePort 로 도메인 전체를 한 번에 본다.
  */

  /* ── 실시간 ── */
  /**
   * 전투가 바뀌면 알린다. 돌려받은 함수를 부르면 그만 듣는다.
   *
   * **어떻게 알아내는지는 어댑터가 정한다** — 서버 구현은 Realtime 에 안전망 폴링을
   * 겹치고, 로컬 구현은 다른 탭이 저장할 때 뜨는 storage 이벤트를 듣는다.
   *
   * 예전에는 이 메서드가 서버 구현에만 있어서, 화면마다 구체 어댑터를 꺼내 보고
   * setInterval 을 손으로 박았다. 그 결과 같은 목적의 주기가 3초 · 10초 · 15초로
   * 갈렸고, 백엔드가 무엇인지를 화면이 알아야 했다.
   */
  subscribe(battleId: string, onChange: () => void): () => void;

  /** 채널에 글이 오가면 알린다. 규칙은 subscribe 와 같다. */
  subscribeChat(channel: string, onMessage: () => void): () => void;

  /* ── 채팅 ── */
  listMessages(channel: string, limit?: number): Promise<ChatMessage[]>;
  postMessage(message: ChatMessage): Promise<void>;
  deleteMessage(id: string): Promise<void>;

  /* ── 공략 기록 ── */
  listRecords(): Promise<BattleRecord[]>;
  /**
   * 공개 기록 한 건. 주소만 알면 누구나 읽는다 — 커뮤니티에 붙이는 용도다.
   * listRecords 는 로그인한 사람에게만 열리므로, 공개 화면은 이쪽을 쓴다.
   */
  getPublicRecord(id: string): Promise<PublicRecord | null>;
  saveRecord(record: BattleRecord): Promise<void>;
  deleteRecord(id: string): Promise<void>;

  /** 전체 데이터를 JSON 문자열로 내보낸다 (운영진 백업용) */
  exportAll(): Promise<string>;
  /** exportAll 로 만든 JSON 을 되돌린다 */
  importAll(json: string): Promise<void>;
}

/**
 * 내보내기 봉투.
 *
 * 스키마 버전을 함께 담아 구조가 바뀌어도 Import 시 판별할 수 있게 한다.
 * 예전 파일에는 없는 항목이 있을 수 있으므로 전투 외 항목은 모두 선택 사항으로 둔다.
 */
export interface ExportEnvelope {
  schemaVersion: number;
  exportedAt: string;
  battles: BattleState[];
  bonds?: PairBond[];
  enemyTemplates?: EnemyTemplate[];
  shopItems?: ShopItemRecord[];
  rouletteWheels?: RouletteWheel[];
  records?: BattleRecord[];
}
