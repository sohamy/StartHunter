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
  ItemStack,
  SheetProfile,
  Session,
  SkillDefinition,
  StatBlock,
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
 * 공개 프로필 — 참가자가 제출한 시트 내용 전부.
 *
 * 스탯도 스킬 수치도 그대로 실린다. 참가자끼리 서로의 캐릭터를 읽는 것이 목적이므로
 * 시트에 적어 낸 것 중 가리는 항목은 없다 (config/characters.ts 의 SHEET_DISCLOSURE).
 *
 * 시트 전문(CharacterSheet)과 다른 점은 계정 소유 정보뿐이다 —
 * 내부 id · 등록 시각은 담지 않고, 활동명만 들고 다닌다.
 */
export interface PublicProfile extends SheetProfile {
  accountId: string;
  side: ActorSide;
  name: string;
  /** 참가자가 적어 둔 페어 이름. 공란일 수 있다. */
  pairName: string;
  /** 참가자가 적어 둔 계약 상대 이름. 공란일 수 있다. */
  partnerName: string;
  classId: string;
  affiliation: Affiliation;
  /** 캐릭터 사진 — 시트 전문 없이도 얼굴은 서로 볼 수 있게 한다 */
  portrait?: string | null;
  stats: StatBlock;
  /** 강화 아이템으로 영구히 올린 능력치 */
  statBonus: StatBlock;
  skills: SkillDefinition[];
  /** 소지금 — 개인 소유 */
  points: number;
  /** 개인 가방 */
  inventory: ItemStack[];
}

/**
 * 시트 전문 → 공개 프로필.
 *
 * 로컬 모드에는 서버 뷰가 없으므로, 두 어댑터가 모두 이 함수를 거쳐 같은 모양을 만든다.
 */
export function toPublicProfile(accountId: string, sheet: CharacterSheet): PublicProfile {
  return {
    accountId,
    side: sheet.side,
    name: sheet.name,
    pairName: sheet.pairName ?? '',
    partnerName: sheet.partnerName ?? '',
    classId: sheet.classId,
    affiliation: sheet.affiliation,
    portrait: sheet.portrait ?? null,
    stats: sheet.stats ?? {},
    statBonus: sheet.statBonus ?? {},
    skills: sheet.skills ?? [],
    points: sheet.points ?? 0,
    inventory: sheet.inventory ?? [],
    ...toProfile(sheet),
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

export type TradeKind = 'BUY' | 'SELL';

/** 거래 뒤의 지갑 — 서버가 계산한 값이 그대로 온다 */
export interface TradeResult {
  points: number;
  inventory: ItemStack[];
}

/** 선물 한 건 — 활동명으로 상대를 지목한다 */
export interface GiftInput {
  /** 받는 사람의 활동명 */
  toHandle: string;
  kind: 'POINTS' | 'ITEM';
  /** kind 가 ITEM 일 때의 품목 */
  itemId?: string | null;
  /** 보낼 금액 또는 개수 */
  amount: number;
}

/** 선물을 보낸 뒤의 내 지갑과, 받은 사람 표기 */
export interface GiftResult extends TradeResult {
  /** 받은 사람의 이름 — 활동명이 아니라 캐릭터 이름을 돌려준다 */
  toName: string;
}

/** 강화 아이템을 쓴 뒤의 시트 */
export interface UseSupplyOutcome {
  statBonus: StatBlock;
  inventory: ItemStack[];
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
  /**
   * 보급 구매 · 반납.
   *
   * 값 계산과 규칙 판정은 **서버가** 한다 (`shop_trade`).
   * 브라우저가 소지금을 계산해 저장하면 마음먹은 사람이 숫자를 고칠 수 있기 때문이다.
   * 거절 사유는 AuthError 로 온다 — 화면은 그대로 보여 주기만 하면 된다.
   */
  tradeItem(itemId: string, kind: TradeKind): Promise<TradeResult>;
  /**
   * 선물하기 — 활동명으로 상대를 찾아 소지금이나 보급품을 넘긴다.
   * 판정은 서버(`shop_gift`)가 한다. 전투에 배치된 동안에는 창구가 닫힌다.
   */
  giftTo(input: GiftInput): Promise<GiftResult>;
  /**
   * 강화 아이템 사용 — 전투 밖에서만 쓴다.
   * 가방에서 하나 빠지고 시트의 statBonus 가 오른다. 판정은 서버(`use_supply`)가 한다.
   */
  useSupply(itemId: string): Promise<UseSupplyOutcome>;
  /** 운영진용 — 참가자 시트를 지운다. 편성 기록(PairBond)은 남는다. */
  deleteSheet(sheetId: string): Promise<void>;
  deleteAccount(accountId: string): Promise<void>;
}
