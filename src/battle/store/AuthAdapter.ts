/**
 * 계정 · 세션 인터페이스.
 *
 * UI 는 이 인터페이스만 참조한다.
 * 서버(Supabase Auth 등)가 붙으면 이 파일을 구현하는 어댑터로 교체하며,
 * 화면 코드는 수정하지 않는다.
 */

import type { Account, ActorSide, CharacterSheet, Session } from '../types';

export interface RegisterInput {
  id: string;
  password: string;
  sheet: Omit<CharacterSheet, 'id' | 'createdAt'>;
}

export interface Credentials {
  id: string;
  password: string;
}

/** 다른 참가자에게 공개해도 되는 정보만 담는다. */
export interface PublicProfile {
  accountId: string;
  side: ActorSide;
  name: string;
  classId: string;
}

/**
 * 시트 전문 + 소유 계정.
 *
 * 운영진 화면 전용이다. 스탯과 커스텀 스킬이 그대로 들어 있으므로
 * 서버에서는 RLS(sheets read own or is_operator)가 참가자에게는 빈 목록을 준다.
 */
export interface SheetRecord {
  /** 활동명 — 편성(PairBond)에서 쓰는 식별자와 같다 */
  accountId: string;
  sheet: CharacterSheet;
}

export type AuthErrorCode =
  | 'ID_TAKEN'
  | 'NOT_FOUND'
  | 'BAD_PASSWORD'
  | 'INVALID_INPUT'
  | 'UNAVAILABLE';

export class AuthError extends Error {
  code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'AuthError';
  }
}

export interface AuthAdapter {
  register(input: RegisterInput): Promise<Account>;
  login(credentials: Credentials): Promise<Session>;
  logout(): Promise<void>;
  currentSession(): Promise<Session | null>;
  /** 활동명 또는 내부 계정 id 로 조회한다. 둘 다 받아야 한다. */
  getAccount(accountId: string): Promise<Account | null>;
  /** 페어 상대를 고르기 위한 목록. 비밀 정보는 포함하지 않는다. */
  listProfiles(side?: ActorSide): Promise<PublicProfile[]>;
  /**
   * 운영진용 시트 전문 목록.
   * 권한이 없으면 빈 배열을 준다 — 화면에서 "없음"과 "권한 없음"을 구분해 안내한다.
   */
  listSheets(): Promise<SheetRecord[]>;
  updateSheet(accountId: string, sheet: CharacterSheet): Promise<Account>;
  deleteAccount(accountId: string): Promise<void>;
}
