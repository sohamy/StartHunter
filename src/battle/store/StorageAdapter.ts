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

export interface StorageAdapter {
  loadBattle(id: string): Promise<BattleState | null>;
  saveBattle(state: BattleState): Promise<void>;
  listBattles(): Promise<BattleSummary[]>;
  deleteBattle(id: string): Promise<void>;

  /* ── 영구 편성 ── */
  listBonds(): Promise<PairBond[]>;
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
