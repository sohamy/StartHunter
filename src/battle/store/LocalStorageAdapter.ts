/**
 * LocalStorage 기반 임시 저장 구현.
 *
 * 어디까지나 저장 계층의 구현체 하나이며, 서버가 붙으면 교체된다.
 * 브라우저가 아닌 환경(빌드 시점 SSR)에서도 안전하게 동작해야 한다.
 */

import { SCHEMA_VERSION } from '../config/rules';
import { newUuid } from '../engine/id';
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
import type { AuditDraft, AuditEntry, AuditPort } from './ports/AuditPort';
import type { RouletteCatalog } from './ports/RoulettePort';
import type { ShopCatalog } from './ports/ShopPort';
import type {
  ExportEnvelope,
  PublicPair,
  PublicRecord,
  StorageAdapter,
} from './StorageAdapter';

const KEY_PREFIX = 'sh.battle.';
const INDEX_KEY = 'sh.battle.index';
const BONDS_KEY = 'sh.roster.bonds';
const SHOP_KEY = 'sh.shop.items';
const WHEELS_KEY = 'sh.roulette.wheels';
const SPINS_KEY = 'sh.roulette.spins';
const ENEMIES_KEY = 'sh.roster.enemies';
const CHAT_KEY = 'sh.chat.messages';
const RECORDS_KEY = 'sh.records.battles';
const AUDIT_KEY = 'sh.ops.audit';

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

/*
   선반(상점 진열)과 원반은 세계 데이터라 전투 · 명부와 같은 저장소에 산다.
   도메인 전체는 ports/ShopPort · ports/RoulettePort 에서 본다.
*/
export class LocalStorageAdapter
  implements StorageAdapter, ShopCatalog, RouletteCatalog, AuditPort
{
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
      shopItems: await this.listItems(),
      rouletteWheels: await this.listWheels(),
      records: await this.listRecords(),
    };
    return JSON.stringify(envelope, null, 2);
  }

  /* ── 공략 기록 ── */

  /*
     로컬 모드에는 「공개」라는 것이 없다 — 저장소가 이 브라우저 안에만 있으므로
     주소를 남에게 줘도 열리지 않는다. 그래도 화면이 같은 길을 타게 두려고
     같은 모양으로 골라 돌려준다. 지갑을 빼는 규칙도 서버 뷰와 맞춘다.
  */
  async getPublicRecord(id: string): Promise<PublicRecord | null> {
    const record = readJson<BattleRecord[]>(RECORDS_KEY, []).find((row) => row.id === id);
    if (!record) return null;
    if (record.status !== 'CLEARED' && record.status !== 'FAILED') return null;

    return {
      id: record.id,
      mode: record.mode,
      operation: record.operation,
      status: record.status,
      rounds: record.rounds,
      finishedAt: record.finishedAt,
      bossName: record.bossName,
      gimmick: record.gimmick,
      pairs: record.pairs.map((pair) => ({
        pairId: pair.pairId,
        label: pair.label,
        hunterName: pair.hunterName,
        constellationName: pair.constellationName,
        affiliation: pair.affiliation,
        hunterHp: pair.hunterHp,
        hunterMaxHp: pair.hunterMaxHp,
        injury: pair.injury,
        constellationStage: pair.constellationStage,
        contract: { stage: pair.contract.stage, value: pair.contract.value },
        pointsEarned: pair.pointsEarned,
      })),
      log: record.log
        .filter((entry) => entry.channel === 'ROLEPLAY')
        .map((entry) => ({ id: entry.id, at: entry.at, text: entry.text })),
    };
  }

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

  async listItems(): Promise<ShopItemRecord[]> {
    return readJson<ShopItemRecord[]>(SHOP_KEY, []).sort((a, b) => a.sort - b.sort);
  }

  async saveItem(record: ShopItemRecord): Promise<void> {
    const rows = (await this.listItems()).filter((row) => row.itemId !== record.itemId);
    writeJson(SHOP_KEY, [...rows, record]);
  }

  async deleteItem(itemId: string): Promise<void> {
    writeJson(
      SHOP_KEY,
      (await this.listItems()).filter((row) => row.itemId !== itemId),
    );
  }

  /* ── 룰렛 원반 ── */

  async listWheels(): Promise<RouletteWheel[]> {
    return readJson<RouletteWheel[]>(WHEELS_KEY, []).sort((a, b) => a.sort - b.sort);
  }

  async saveWheel(wheel: RouletteWheel): Promise<void> {
    const rows = (await this.listWheels()).filter((row) => row.id !== wheel.id);
    writeJson(WHEELS_KEY, [...rows, wheel]);
  }

  async deleteWheel(id: string): Promise<void> {
    writeJson(
      WHEELS_KEY,
      (await this.listWheels()).filter((row) => row.id !== id),
    );
  }

  async deleteSpin(id: string): Promise<void> {
    writeJson(
      SPINS_KEY,
      readRouletteSpins().filter((row) => row.id !== id),
    );
  }

  async clearSpins(): Promise<void> {
    writeJson(SPINS_KEY, []);
  }

  async recentSpins(limit = 50): Promise<RouletteSpin[]> {
    return readRouletteSpins().slice(0, limit);
  }

  /* ── 운영 감사 기록 ── */

  /*
     로컬 모드에는 운영진과 참가자를 가르는 벽이 없다 — 브라우저 저장소를 열면
     누구든 고칠 수 있으므로, 여기 남는 기록은 「분쟁의 근거」가 아니라
     혼자 굴려 볼 때 무엇을 만졌는지 되짚는 메모다.
  */
  async record(draft: AuditDraft): Promise<void> {
    const entry: AuditEntry = {
      ...draft,
      id: newUuid(),
      at: new Date().toISOString(),
      byHandle: '관리국',
    };
    writeJson(AUDIT_KEY, [entry, ...readJson<AuditEntry[]>(AUDIT_KEY, [])].slice(0, 500));
  }

  async listAudit(limit = 200): Promise<AuditEntry[]> {
    return readJson<AuditEntry[]>(AUDIT_KEY, []).slice(0, limit);
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
      await this.saveItem(row);
    }
    for (const wheel of envelope.rouletteWheels ?? []) {
      await this.saveWheel(wheel);
    }
    for (const record of envelope.records ?? []) {
      await this.saveRecord(record);
    }
  }
}
