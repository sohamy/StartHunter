/**
 * 계정 · 세션 인터페이스.
 *
 * UI 는 이 인터페이스만 참조한다.
 * 서버(Supabase Auth 등)가 붙으면 이 파일을 구현하는 어댑터로 교체하며,
 * 화면 코드는 수정하지 않는다.
 */

import { toProfile } from '../config/characters';
import type {
  Account,
  ActorSide,
  Affiliation,
  CharacterSheet,
  PublicSkill,
  SheetProfile,
  Session,
} from '../types';

export interface RegisterInput {
  id: string;
  password: string;
  sheet: Omit<CharacterSheet, 'id' | 'createdAt'>;
}

export interface Credentials {
  id: string;
  password: string;
}

/**
 * 공개 시트 — 다른 참가자에게 보여도 되는 범위.
 *
 * 무엇을 열고 무엇을 닫는지는 config/characters.ts 의 SHEET_DISCLOSURE 한 곳에 적혀 있다.
 * 서버에서는 public_profiles 뷰가 같은 경계를 한 번 더 긋는다 — 화면을 고쳐도 수치는 새지 않는다.
 */
export interface PublicProfile extends SheetProfile {
  accountId: string;
  side: ActorSide;
  name: string;
  /** 참가자가 적어 둔 계약 상대 이름. 공란일 수 있다. */
  partnerName: string;
  classId: string;
  affiliation: Affiliation;
  /** 캐릭터 사진 — 시트 전문 없이도 얼굴은 서로 볼 수 있게 한다 */
  portrait?: string | null;
  /** 이름 · 종류 · 설명까지만. 수치(AP · 위력 · 쿨)는 운영진 전용이다. */
  skills: PublicSkill[];
}

/**
 * 시트 전문에서 공개분만 떼어 낸다.
 *
 * 로컬 모드에는 서버 뷰가 없으므로, 두 어댑터가 모두 이 함수를 거쳐 같은 경계를 지킨다.
 */
export function toPublicProfile(accountId: string, sheet: CharacterSheet): PublicProfile {
  return {
    accountId,
    side: sheet.side,
    name: sheet.name,
    partnerName: sheet.partnerName ?? '',
    classId: sheet.classId,
    affiliation: sheet.affiliation,
    portrait: sheet.portrait ?? null,
    ...toProfile(sheet),
    skills: (sheet.skills ?? []).map((skill) => ({
      id: skill.id,
      name: skill.name,
      kind: skill.kind,
      description: skill.description,
    })),
  };
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
  /**
   * 페어 상대를 고르기 위한 목록. 비밀 정보는 포함하지 않는다.
   *
   * 전체 인원을 카드로 늘어놓는 화면은 운영진 작전실에만 있다 —
   * 참가자 화면은 자기 시트와 페어 상대 한 명만 본다.
   */
  listProfiles(side?: ActorSide): Promise<PublicProfile[]>;
  /** 한 사람의 공개 프로필. 페어 상대를 보여줄 때 쓴다. */
  getPublicProfile(accountId: string): Promise<PublicProfile | null>;
  /**
   * 운영진용 시트 전문 목록.
   * 권한이 없으면 빈 배열을 준다 — 화면에서 "없음"과 "권한 없음"을 구분해 안내한다.
   */
  listSheets(): Promise<SheetRecord[]>;
  updateSheet(accountId: string, sheet: CharacterSheet): Promise<Account>;
  /** 운영진용 — 참가자 시트를 지운다. 편성 기록(PairBond)은 남는다. */
  deleteSheet(sheetId: string): Promise<void>;
  deleteAccount(accountId: string): Promise<void>;
}
