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
  RouletteSpin,
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

  /** 상점 진열 — 운영진이 작전실에서 직접 넣고 고친다 */
  listShopItems(): Promise<ShopItemRecord[]>;
  saveShopItem(record: ShopItemRecord): Promise<void>;
  deleteShopItem(itemId: string): Promise<void>;

  /** 룰렛 원반 — 상점과 달리 코드에 기본 목록이 없다. 운영진이 만든 것이 전부다 */
  listRouletteWheels(): Promise<RouletteWheel[]>;
  saveRouletteWheel(wheel: RouletteWheel): Promise<void>;
  deleteRouletteWheel(id: string): Promise<void>;
  /**
   * 최근 회전 기록 — 도박장 전광판과 운영진 확인에 쓴다.
   * 소지금은 담기지 않는다 (전광판은 남의 지갑을 보여 주는 곳이 아니다).
   */
  listRouletteSpins(limit?: number): Promise<RouletteSpin[]>;
  /** 회전 기록 한 줄을 지운다 — 운영진만 된다 (0019 · spins operator delete) */
  deleteRouletteSpin(id: string): Promise<void>;
  /**
   * 회전 기록을 전부 지운다 — 운영진만 된다.
   * 소지금은 건드리지 않는다. 기록은 정산 근거가 아니라 전광판이므로 지워도 지갑은 그대로다.
   */
  clearRouletteSpins(): Promise<void>;

  /* ── 채팅 ── */
  listMessages(channel: string, limit?: number): Promise<ChatMessage[]>;
  postMessage(message: ChatMessage): Promise<void>;
  deleteMessage(id: string): Promise<void>;

  /* ── 공략 기록 ── */
  listRecords(): Promise<BattleRecord[]>;
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
