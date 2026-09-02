/**
 * 계정 포트 — **사람에게 붙는 것** 전부.
 *
 * 로그인과 세션, 그 사람의 시트, 이름으로 보내는 선물, 운영진의 계정 · 시트 삭제.
 * 공통점은 계정 하나가 주인이라는 것이다.
 *
 * 예전 이름은 AuthAdapter 였는데, 인증만 있는 것이 아니어서 이름이 사실과 달랐다.
 * 상점 매매 · 보급품 사용 · 원반 돌리기까지 여기 들어 있던 것은
 * ports/ShopPort · ports/RoulettePort 로 옮겼다 — 그쪽은 도메인이 따로 있다.
 * 구현 클래스는 여전히 그 창구들을 함께 구현한다(세션이 필요한 일이라서).
 *
 * UI 는 이 인터페이스만 참조한다. 백엔드가 바뀌어도 화면 코드는 손대지 않는다.
 */

import { toProfile } from '../config/characters';
import type { TradeResult } from './ports/ShopPort';
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

/** 선물 한 건 — 이름으로 상대를 지목한다 */
export interface GiftInput {
  /** 받는 사람의 이름. 이름은 겹치지 않으므로 한 사람만 걸린다. */
  toName: string;
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

/** 선물 받을 사람 미리보기 — 보내기 전에 누구인지 눈으로 확인시킨다 */
export interface GiftTarget {
  name: string;
  side: ActorSide;
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

export interface AccountAdapter {
  /**
   * 비밀번호 최소 길이.
   *
   * 구현이 정한다 — 서버 구현은 Supabase Auth 가 6자를 강제하고, 로컬 구현은 4자다.
   * 이 값이 없던 동안 등록 화면은 `isServerMode() ? 6 : 4` 로 백엔드 종류를 직접
   * 되물었다. 화면이 알아야 할 것은 「몇 자냐」이지 「어느 백엔드냐」가 아니다.
   */
  readonly minPasswordLength: number;

  register(input: RegisterInput): Promise<Account>;
  login(credentials: Credentials): Promise<Session>;
  /**
   * 비밀번호 변경 — 본인만.
   *
   * 지금 비밀번호를 함께 받아 다시 확인한다. 서버 구현의 updateUser 는 옛 비밀번호를
   * 묻지 않으므로, 잠그지 않은 화면 앞에 앉은 사람이 조용히 바꿔 버릴 수 있다.
   *
   * 활동명이 가상 이메일로 들어가 있어 **메일로 되찾는 길은 없다.** 잊은 사람은
   * 운영진이 resetPassword 로 임시 비밀번호를 내주고, 그 사람이 여기서 다시 바꾼다.
   */
  changePassword(currentPassword: string, nextPassword: string): Promise<void>;
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

  /*
     상점 매매 · 보급품 사용 · 원반 돌리기는 여기 없다 —
     ports/ShopPort 의 ShopCounter, ports/RoulettePort 의 RouletteCounter 로 갔다.
     구현은 여전히 이 클래스가 한다. 사람의 지갑을 건드리는 일이라 세션이 필요하고,
     서버 모드에서는 판정 자체가 RPC 뒤에 있기 때문이다.
  */

  /**
   * 선물하기 — 이름으로 상대를 찾아 소지금이나 보급품을 넘긴다.
   * 판정은 서버(`shop_gift`)가 한다. 전투에 배치된 동안에는 창구가 닫힌다.
   */
  giftTo(input: GiftInput): Promise<GiftResult>;
  /**
   * 이름으로 사람을 찾는다 — 선물을 보내기 전에 누구인지 보여 주기 위한 것이다.
   * 없으면 null. 통과 여부는 보낼 때 서버가 다시 정한다.
   */
  findGiftTarget(name: string): Promise<GiftTarget | null>;
  /** 운영진용 — 참가자 시트를 지운다. 편성 기록(PairBond)은 남는다. */
  deleteSheet(sheetId: string): Promise<void>;
  deleteAccount(accountId: string): Promise<void>;
}
