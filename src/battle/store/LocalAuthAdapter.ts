/**
 * 브라우저 저장소 기반 계정 구현 — 임시 계층.
 *
 * ⚠ 이것은 인증이 아니다.
 * 계정과 비밀번호 해시가 모두 같은 브라우저에 저장되므로 위조를 막을 수 없다.
 * "이 브라우저에 등록된 캐릭터 시트를 잠가 두는" 용도이며,
 * 실제 인증은 서버 어댑터로 교체해 처리한다.
 */

import { toProfile } from '../config/characters';
import { addItem, quantityOf } from '../engine/items';
import { giftRoom, purchase, refund, useSupply } from '../engine/shop';
import type { Account, ActorSide, CharacterSheet, Session } from '../types';
import {
  AuthError,
  toPublicProfile,
  type AuthAdapter,
  type Credentials,
  type PublicProfile,
  type RegisterInput,
  type SheetRecord,
  type GiftInput,
  type GiftResult,
  type TradeKind,
  type TradeResult,
  type UseSupplyOutcome,
} from './AuthAdapter';

const ACCOUNTS_KEY = 'sh.auth.accounts';
const SESSION_KEY = 'sh.auth.session';

function storage(): Storage {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    /* 접근 차단 시 아래에서 처리 */
  }
  throw new AuthError('UNAVAILABLE', '브라우저 저장소를 사용할 수 없습니다.');
}

/**
 * 이 브라우저에 남아 있는 옛 시트를 지금 모양으로 맞춘다.
 * 컨셉 한 칸(concept)만 있던 시절의 시트도 그대로 열려야 한다.
 */
function migrateSheet(sheet: CharacterSheet): CharacterSheet {
  return {
    ...sheet,
    pairName: sheet.pairName ?? '',
    partnerName: sheet.partnerName ?? '',
    ...toProfile(sheet as CharacterSheet & { concept?: string }),
  };
}

function readAccounts(): Account[] {
  try {
    const raw = storage().getItem(ACCOUNTS_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as Account[]).map((account) => ({
      ...account,
      sheet: migrateSheet(account.sheet),
    }));
  } catch (error) {
    if (error instanceof AuthError) throw error;
    return [];
  }
}

function writeAccounts(accounts: Account[]): void {
  storage().setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

/**
 * 비밀번호 해시.
 * SubtleCrypto 를 쓸 수 없는 환경(비보안 컨텍스트)에서는 약한 대체 해시로 내려간다.
 * 어느 쪽이든 서버 인증의 대체물이 아니다.
 */
async function hashPassword(password: string): Promise<string> {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (subtle) {
    const bytes = new TextEncoder().encode(`sh.v1.${password}`);
    const digest = await subtle.digest('SHA-256', bytes);
    return `sha256:${[...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')}`;
  }

  let hash = 0;
  for (let index = 0; index < password.length; index += 1) {
    hash = (hash * 31 + password.charCodeAt(index)) | 0;
  }
  return `weak:${hash}`;
}

function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}

function newSheetId(side: ActorSide): string {
  const stamp = Date.now().toString(36);
  const salt = Math.floor(Math.random() * 1e6).toString(36);
  return `${side === 'HUNTER' ? 'HS' : 'CS'}-${stamp}-${salt}`;
}

export class LocalAuthAdapter implements AuthAdapter {
  async register(input: RegisterInput): Promise<Account> {
    const id = input.id.trim();
    if (id.length < 2) {
      throw new AuthError('INVALID_INPUT', '활동명은 2자 이상 입력하세요.');
    }
    if (input.password.length < 4) {
      throw new AuthError('INVALID_INPUT', '비밀번호는 4자 이상 입력하세요.');
    }

    const accounts = readAccounts();
    if (accounts.some((account) => normalizeId(account.id) === normalizeId(id))) {
      throw new AuthError('ID_TAKEN', '이미 등록된 활동명입니다.');
    }

    const now = new Date().toISOString();
    const account: Account = {
      id,
      passwordHash: await hashPassword(input.password),
      createdAt: now,
      sheet: {
        ...input.sheet,
        id: newSheetId(input.sheet.side),
        createdAt: now,
      },
    };

    writeAccounts([...accounts, account]);
    storage().setItem(
      SESSION_KEY,
      JSON.stringify({ accountId: account.id, startedAt: now } satisfies Session),
    );
    return account;
  }

  async login(credentials: Credentials): Promise<Session> {
    const account = readAccounts().find(
      (row) => normalizeId(row.id) === normalizeId(credentials.id),
    );
    if (!account) {
      throw new AuthError('NOT_FOUND', '등록되지 않은 활동명입니다.');
    }

    const hash = await hashPassword(credentials.password);
    if (hash !== account.passwordHash) {
      throw new AuthError('BAD_PASSWORD', '비밀번호가 일치하지 않습니다.');
    }

    const session: Session = { accountId: account.id, startedAt: new Date().toISOString() };
    storage().setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  async logout(): Promise<void> {
    storage().removeItem(SESSION_KEY);
  }

  async currentSession(): Promise<Session | null> {
    try {
      const raw = storage().getItem(SESSION_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw) as Session;
      // 계정이 삭제된 세션은 무효로 본다.
      const exists = readAccounts().some((account) => account.id === session.accountId);
      return exists ? session : null;
    } catch {
      return null;
    }
  }

  async getAccount(accountId: string): Promise<Account | null> {
    return readAccounts().find((account) => account.id === accountId) ?? null;
  }

  async listProfiles(side?: ActorSide): Promise<PublicProfile[]> {
    return readAccounts()
      .filter((account) => !side || account.sheet.side === side)
      .map((account) => toPublicProfile(account.id, account.sheet));
  }

  async getPublicProfile(accountId: string): Promise<PublicProfile | null> {
    const found = readAccounts().find((account) => account.id === accountId);
    return found ? toPublicProfile(found.id, found.sheet) : null;
  }

  /**
   * 로컬 모드에는 서버가 없다 — 같은 규칙을 이 자리에서 계산한다.
   * 혼자 확인해 보는 경로이므로 배치 여부까지는 보지 않는다 (화면이 먼저 막는다).
   */
  async tradeItem(itemId: string, kind: TradeKind): Promise<TradeResult> {
    const session = await this.currentSession();
    if (!session) throw new AuthError('NOT_FOUND', '접속 상태가 아닙니다.');

    const accounts = readAccounts();
    const index = accounts.findIndex((account) => account.id === session.accountId);
    if (index < 0) throw new AuthError('NOT_FOUND', '계정을 찾을 수 없습니다.');

    const sheet = migrateSheet(accounts[index].sheet);
    const result = kind === 'BUY' ? purchase(sheet, itemId, 1) : refund(sheet, itemId);
    if (!result.ok) throw new AuthError('INVALID_INPUT', result.reason ?? '처리하지 못했습니다.');

    accounts[index] = {
      ...accounts[index],
      sheet: { ...sheet, points: result.points, inventory: result.inventory },
    };
    writeAccounts(accounts);
    return { points: result.points, inventory: result.inventory };
  }

  /** 선물 — 로컬 모드에서는 같은 브라우저 안의 두 계정 사이에서만 오간다 */
  async giftTo(input: GiftInput): Promise<GiftResult> {
    const session = await this.currentSession();
    if (!session) throw new AuthError('NOT_FOUND', '접속 상태가 아닙니다.');

    const accounts = readAccounts();
    const from = accounts.findIndex((account) => account.id === session.accountId);
    const to = accounts.findIndex(
      (account) => account.id.toLowerCase() === input.toHandle.trim().toLowerCase(),
    );
    if (from < 0) throw new AuthError('NOT_FOUND', '계정을 찾을 수 없습니다.');
    if (to < 0) throw new AuthError('NOT_FOUND', '그런 활동명을 찾을 수 없습니다.');
    if (from === to) throw new AuthError('INVALID_INPUT', '자기 자신에게는 보낼 수 없습니다.');

    const amount = Math.floor(input.amount);
    if (amount < 1) throw new AuthError('INVALID_INPUT', '1 이상을 보내세요.');

    const sender = migrateSheet(accounts[from].sheet);
    const receiver = migrateSheet(accounts[to].sheet);

    if (input.kind === 'POINTS') {
      if ((sender.points ?? 0) < amount) {
        throw new AuthError('INVALID_INPUT', '소지금이 부족합니다.');
      }
      sender.points = (sender.points ?? 0) - amount;
      receiver.points = (receiver.points ?? 0) + amount;
    } else {
      const itemId = input.itemId ?? '';
      if (quantityOf(sender.inventory ?? [], itemId) < amount) {
        throw new AuthError('INVALID_INPUT', '보유 개수가 모자랍니다.');
      }
      if (giftRoom(receiver.inventory ?? [], itemId) < amount) {
        throw new AuthError('INVALID_INPUT', '받는 쪽의 보유 한도를 넘습니다.');
      }
      sender.inventory = addItem(sender.inventory ?? [], itemId, -amount);
      receiver.inventory = addItem(receiver.inventory ?? [], itemId, amount);
    }

    accounts[from] = { ...accounts[from], sheet: sender };
    accounts[to] = { ...accounts[to], sheet: receiver };
    writeAccounts(accounts);

    return {
      points: sender.points ?? 0,
      inventory: sender.inventory ?? [],
      toName: receiver.name,
    };
  }

  /** 강화 아이템 사용 — 가방에서 하나 빠지고 시트의 능력치가 영구히 오른다 */
  async useSupply(itemId: string): Promise<UseSupplyOutcome> {
    const session = await this.currentSession();
    if (!session) throw new AuthError('NOT_FOUND', '접속 상태가 아닙니다.');

    const accounts = readAccounts();
    const index = accounts.findIndex((account) => account.id === session.accountId);
    if (index < 0) throw new AuthError('NOT_FOUND', '계정을 찾을 수 없습니다.');

    const sheet = migrateSheet(accounts[index].sheet);
    const result = useSupply(sheet, itemId);
    if (!result.ok) throw new AuthError('INVALID_INPUT', result.reason ?? '쓰지 못했습니다.');

    accounts[index] = {
      ...accounts[index],
      sheet: { ...sheet, statBonus: result.statBonus, inventory: result.inventory },
    };
    writeAccounts(accounts);
    return { statBonus: result.statBonus, inventory: result.inventory };
  }

  async listSheets(): Promise<SheetRecord[]> {
    // 로컬 모드에는 권한 구분이 없다 — 이 브라우저의 시트를 모두 준다.
    return readAccounts().map((account) => ({
      accountId: account.id,
      sheet: account.sheet,
    }));
  }

  async updateSheet(accountId: string, sheet: CharacterSheet): Promise<Account> {
    const accounts = readAccounts();
    const index = accounts.findIndex((account) => account.id === accountId);
    if (index < 0) {
      throw new AuthError('NOT_FOUND', '계정을 찾을 수 없습니다.');
    }

    const updated: Account = { ...accounts[index], sheet };
    accounts[index] = updated;
    writeAccounts(accounts);
    return updated;
  }

  /** 로컬 모드는 1계정 = 1시트이므로 계정을 지운다 */
  async deleteSheet(sheetId: string): Promise<void> {
    const target = readAccounts().find((account) => account.sheet.id === sheetId);
    if (!target) throw new AuthError('NOT_FOUND', '시트를 찾을 수 없습니다.');
    await this.deleteAccount(target.id);
  }

  async deleteAccount(accountId: string): Promise<void> {
    writeAccounts(readAccounts().filter((account) => account.id !== accountId));
    const session = await this.currentSession();
    if (session?.accountId === accountId) await this.logout();
  }
}
