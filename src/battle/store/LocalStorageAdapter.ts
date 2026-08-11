/**
 * LocalStorage 기반 임시 저장 구현.
 *
 * 어디까지나 저장 계층의 구현체 하나이며, 서버가 붙으면 교체된다.
 * 브라우저가 아닌 환경(빌드 시점 SSR)에서도 안전하게 동작해야 한다.
 */

import { SCHEMA_VERSION } from '../config/rules';
import type { BattleState, BattleSummary, EnemyTemplate, PairBond } from '../types';
import type { ExportEnvelope, StorageAdapter } from './StorageAdapter';

const KEY_PREFIX = 'sh.battle.';
const INDEX_KEY = 'sh.battle.index';
const BONDS_KEY = 'sh.roster.bonds';
const ENEMIES_KEY = 'sh.roster.enemies';

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

    const envelope: ExportEnvelope = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      battles,
    };
    return JSON.stringify(envelope, null, 2);
  }

  /* ── 영구 편성 ── */

  async listBonds(): Promise<PairBond[]> {
    return readJson<PairBond[]>(BONDS_KEY, []);
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
  }
}
