/**
 * 브라우저 저장소 기반 계정 구현 — 임시 계층.
 *
 * ⚠ 이것은 인증이 아니다.
 * 계정과 비밀번호 해시가 모두 같은 브라우저에 저장되므로 위조를 막을 수 없다.
 * "이 브라우저에 등록된 캐릭터 시트를 잠가 두는" 용도이며,
 * 실제 인증은 서버 어댑터로 교체해 처리한다.
 */

import type { Account, ActorSide, CharacterSheet, Session } from '../types';
import {
  AuthError,
  type AuthAdapter,
  type Credentials,
  type PublicProfile,
  type RegisterInput,
  type SheetRecord,
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

function readAccounts(): Account[] {
  try {
    const raw = storage().getItem(ACCOUNTS_KEY);
    return raw ? (JSON.parse(raw) as Account[]) : [];
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
      .map((account) => ({
        accountId: account.id,
        side: account.sheet.side,
        name: account.sheet.name,
        classId: account.sheet.classId,
      }));
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
