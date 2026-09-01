/**
 * LocalStorage 기반 임시 저장 구현.
 *
 * 어디까지나 저장 계층의 구현체 하나이며, 서버가 붙으면 교체된다.
 * 브라우저가 아닌 환경(빌드 시점 SSR)에서도 안전하게 동작해야 한다.
 */

import { SCHEMA_VERSION } from '../config/rules';
import type {
  BattleRecord,
  BattleState,
  BattleSummary,
  ChatMessage,
  EnemyTemplate,
  PairBond,
  RouletteSpin,
  RouletteWheel,
  ShopItemRecord,
} from '../types';
import type { ExportEnvelope, PublicPair, StorageAdapter } from './StorageAdapter';

const KEY_PREFIX = 'sh.battle.';
const INDEX_KEY = 'sh.battle.index';
const BONDS_KEY = 'sh.roster.bonds';
const SHOP_KEY = 'sh.shop.items';
const WHEELS_KEY = 'sh.roulette.wheels';
const SPINS_KEY = 'sh.roulette.spins';
const ENEMIES_KEY = 'sh.roster.enemies';
const CHAT_KEY = 'sh.chat.messages';
const RECORDS_KEY = 'sh.records.battles';

interface IndexRow extends BattleSummary {}

function readJson<T>(key: string, fallback: T): T {
  if (!hasStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (!hasStorage()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function hasStorage(): boolean {
  try {
    return typeof window !== 'undefined' && Boolean(window.localStorage);
  } catch {
    return false;
  }
}

/**
 * 룰렛 회전 기록 — 최근 것이 앞에 온다.
 *
 * 서버 모드에서는 `roulette_spin()` 이 표에 직접 남긴다.
 * 로컬 모드에는 서버가 없으므로 계정 어댑터가 돌린 뒤 이 자리에 적는다 —
 * 그래서 이 두 함수만 모듈 밖으로 낸다.
 */
export function readRouletteSpins(): RouletteSpin[] {
  return readJson<RouletteSpin[]>(SPINS_KEY, []);
}

/** 한 줄 적는다. 로컬은 확인용이라 최근 200회만 남긴다 */
export function appendRouletteSpin(spin: RouletteSpin): void {
  writeJson(SPINS_KEY, [spin, ...readRouletteSpins()].slice(0, 200));
}

function readIndex(): IndexRow[] {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as IndexRow[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(rows: IndexRow[]): void {
  if (!hasStorage()) return;
  window.localStorage.setItem(INDEX_KEY, JSON.stringify(rows));
}

function summarize(state: BattleState): BattleSummary {
  return {
    id: state.id,
    mode: state.mode,
    operationName: state.operation.name,
    round: state.round,
    status: state.status,
    updatedAt: new Date().toISOString(),
  };
}

export class LocalStorageAdapter implements StorageAdapter {
  async loadBattle(id: string): Promise<BattleState | null> {
    if (!hasStorage()) return null;
    const raw = window.localStorage.getItem(KEY_PREFIX + id);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as BattleState;
      if (parsed.schemaVersion !== SCHEMA_VERSION) {
        // 구조가 바뀐 데이터는 조용히 쓰지 않고 버린다.
        console.warn(
          `[battle] 저장된 데이터의 schemaVersion(${parsed.schemaVersion})이 현재(${SCHEMA_VERSION})와 달라 무시합니다.`,
        );
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async saveBattle(state: BattleState): Promise<void> {
    if (!hasStorage()) return;
    window.localStorage.setItem(KEY_PREFIX + state.id, JSON.stringify(state));

    const rows = readIndex().filter((row) => row.id !== state.id);
    rows.push(summarize(state));
    writeIndex(rows);
  }

  async listBattles(): Promise<BattleSummary[]> {
    return readIndex();
  }

  async deleteBattle(id: string): Promise<void> {
    if (!hasStorage()) return;
    window.localStorage.removeItem(KEY_PREFIX + id);
    writeIndex(readIndex().filter((row) => row.id !== id));
  }

  async exportAll(): Promise<string> {
    const rows = readIndex();
    const battles: BattleState[] = [];
    for (const row of rows) {
      const state = await this.loadBattle(row.id);
      if (state) battles.push(state);
    }

    // 편성 · 적 세팅 · 공략 기록까지 함께 담는다 — 전투만 백업하면 복구가 되지 않는다.
    const envelope: ExportEnvelope = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      battles,
      bonds: await this.listBonds(),
      enemyTemplates: await this.listEnemyTemplates(),
      shopItems: await this.listShopItems(),
      rouletteWheels: await this.listRouletteWheels(),
      records: await this.listRecords(),
    };
    return JSON.stringify(envelope, null, 2);
  }

  /* ── 공략 기록 ── */

  async listRecords(): Promise<BattleRecord[]> {
    return readJson<BattleRecord[]>(RECORDS_KEY, [])
      .slice()
      .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  }

  async saveRecord(record: BattleRecord): Promise<void> {
    const rows = readJson<BattleRecord[]>(RECORDS_KEY, []).filter((row) => row.id !== record.id);
    writeJson(RECORDS_KEY, [...rows, record]);
  }

  async deleteRecord(id: string): Promise<void> {
    writeJson(
      RECORDS_KEY,
      readJson<BattleRecord[]>(RECORDS_KEY, []).filter((row) => row.id !== id),
    );
  }

  /* ── 영구 편성 ── */

  async listBonds(): Promise<PairBond[]> {
    return readJson<PairBond[]>(BONDS_KEY, []);
  }

  /** 로컬 모드에는 권한이 없다 — 활성 편성만 걸러 같은 모양으로 준다 */
  async listPublicPairs(): Promise<PublicPair[]> {
    return (await this.listBonds())
      .filter((bond) => bond.active)
      .map((bond) => ({
        id: bond.id,
        label: bond.label,
        hunterHandle: bond.hunterAccountId,
        constellationHandle: bond.constellationAccountId,
        hunterName: bond.hunterName,
        constellationName: bond.constellationName,
        affiliation: bond.affiliation,
        createdAt: bond.createdAt,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  }

  async saveBond(bond: PairBond): Promise<void> {
    const rows = (await this.listBonds()).filter((row) => row.id !== bond.id);
    writeJson(BONDS_KEY, [...rows, bond]);
  }

  async deleteBond(id: string): Promise<void> {
    writeJson(
      BONDS_KEY,
      (await this.listBonds()).filter((row) => row.id !== id),
    );
  }

  /* ── 적 세팅 ── */

  async listEnemyTemplates(): Promise<EnemyTemplate[]> {
    return readJson<EnemyTemplate[]>(ENEMIES_KEY, []);
  }

  async saveEnemyTemplate(template: EnemyTemplate): Promise<void> {
    const rows = (await this.listEnemyTemplates()).filter((row) => row.id !== template.id);
    writeJson(ENEMIES_KEY, [...rows, template]);
  }

  async deleteEnemyTemplate(id: string): Promise<void> {
    writeJson(
      ENEMIES_KEY,
      (await this.listEnemyTemplates()).filter((row) => row.id !== id),
    );
  }

  /* ── 상점 진열 ── */

  async listShopItems(): Promise<ShopItemRecord[]> {
    return readJson<ShopItemRecord[]>(SHOP_KEY, []).sort((a, b) => a.sort - b.sort);
  }

  async saveShopItem(record: ShopItemRecord): Promise<void> {
    const rows = (await this.listShopItems()).filter((row) => row.itemId !== record.itemId);
    writeJson(SHOP_KEY, [...rows, record]);
  }

  async deleteShopItem(itemId: string): Promise<void> {
    writeJson(
      SHOP_KEY,
      (await this.listShopItems()).filter((row) => row.itemId !== itemId),
    );
  }

  /* ── 룰렛 원반 ── */

  async listRouletteWheels(): Promise<RouletteWheel[]> {
    return readJson<RouletteWheel[]>(WHEELS_KEY, []).sort((a, b) => a.sort - b.sort);
  }

  async saveRouletteWheel(wheel: RouletteWheel): Promise<void> {
    const rows = (await this.listRouletteWheels()).filter((row) => row.id !== wheel.id);
    writeJson(WHEELS_KEY, [...rows, wheel]);
  }

  async deleteRouletteWheel(id: string): Promise<void> {
    writeJson(
      WHEELS_KEY,
      (await this.listRouletteWheels()).filter((row) => row.id !== id),
    );
  }

  async deleteRouletteSpin(id: string): Promise<void> {
    writeJson(
      SPINS_KEY,
      readRouletteSpins().filter((row) => row.id !== id),
    );
  }

  async clearRouletteSpins(): Promise<void> {
    writeJson(SPINS_KEY, []);
  }

  async listRouletteSpins(limit = 50): Promise<RouletteSpin[]> {
    return readRouletteSpins().slice(0, limit);
  }

  /* ── 채팅 ── */

  async listMessages(channel: string, limit = 200): Promise<ChatMessage[]> {
    const rows = readJson<ChatMessage[]>(CHAT_KEY, []).filter((row) => row.channel === channel);
    return rows.slice(-limit);
  }

  async postMessage(message: ChatMessage): Promise<void> {
    const rows = readJson<ChatMessage[]>(CHAT_KEY, []);
    // 저장소가 무한히 커지지 않도록 최근 500개만 유지한다
    writeJson(CHAT_KEY, [...rows, message].slice(-500));
  }

  async deleteMessage(id: string): Promise<void> {
    writeJson(
      CHAT_KEY,
      readJson<ChatMessage[]>(CHAT_KEY, []).filter((row) => row.id !== id),
    );
  }

  /* ── 실시간 ── */

  /**
   * 로컬 저장소는 **다른 탭**이 값을 바꿀 때 storage 이벤트를 띄운다.
   * 같은 탭에서 바꾼 것은 오지 않지만, 그쪽은 이미 알고 있으므로 문제가 되지 않는다.
   *
   * 폴링이 필요 없다 — 값이 바뀐 순간에 온다.
   */
  private watch(matches: (key: string) => boolean, onChange: () => void): () => void {
    if (typeof window === 'undefined') return () => {};
    const listener = (event: StorageEvent) => {
      // key 가 null 이면 저장소 전체가 비워진 것이다 (clear)
      if (event.key === null || matches(event.key)) onChange();
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }

  subscribe(battleId: string, onChange: () => void): () => void {
    return this.watch((key) => key === KEY_PREFIX + battleId, onChange);
  }

  subscribeChat(_channel: string, onMessage: () => void): () => void {
    // 채널을 가리지 않고 한 칸에 모아 두므로 칸이 바뀌면 알린다 — 거르는 일은 부르는 쪽이 한다
    return this.watch((key) => key === CHAT_KEY, onMessage);
  }

  async importAll(json: string): Promise<void> {
    const envelope = JSON.parse(json) as ExportEnvelope;
    if (!Array.isArray(envelope.battles)) {
      throw new Error('전투 데이터를 찾을 수 없습니다.');
    }
    if (envelope.schemaVersion !== SCHEMA_VERSION) {
      throw new Error(
        `호환되지 않는 데이터입니다. (파일 ${envelope.schemaVersion} / 현재 ${SCHEMA_VERSION})`,
      );
    }
    for (const state of envelope.battles) {
      await this.saveBattle(state);
    }
    for (const bond of envelope.bonds ?? []) {
      await this.saveBond(bond);
    }
    for (const template of envelope.enemyTemplates ?? []) {
      await this.saveEnemyTemplate(template);
    }
    for (const row of envelope.shopItems ?? []) {
      await this.saveShopItem(row);
    }
    for (const wheel of envelope.rouletteWheels ?? []) {
      await this.saveRouletteWheel(wheel);
    }
    for (const record of envelope.records ?? []) {
      await this.saveRecord(record);
    }
  }
}
