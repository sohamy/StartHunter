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
  records?: BattleRecord[];
}
