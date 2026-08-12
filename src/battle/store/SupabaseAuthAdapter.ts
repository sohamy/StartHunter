/**
 * Supabase 기반 계정 구현.
 *
 * LocalAuthAdapter 와 달리 실제 인증이다 — 비밀번호 검증과 세션이 서버에서 처리된다.
 * 활동명(handle)은 이메일 형태가 아니어도 되게 내부에서 가상 이메일로 변환한다.
 */

import { requireSupabase } from './supabaseClient';
import {
  AuthError,
  type AuthAdapter,
  type AuthErrorCode,
  type Credentials,
  type PublicProfile,
  type RegisterInput,
  type SheetRecord,
} from './AuthAdapter';
import type { Account, ActorSide, CharacterSheet, Session } from '../types';

/**
 * 활동명 → 로그인용 이메일.
 * 참가자는 이메일을 입력하지 않고 활동명만 쓴다.
 */
const HANDLE_DOMAIN = 'hunters.local';

function handleToEmail(handle: string): string {
  const slug = handle
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, (char) => `_${char.charCodeAt(0).toString(36)}`);
  return `${slug}@${HANDLE_DOMAIN}`;
}

/**
 * Supabase 인증 오류를 참가자가 이해할 수 있는 문장으로 바꾼다.
 * 원문을 그대로 보여주면 무엇을 해야 하는지 알 수 없다.
 */
function describeSignUpError(message: string): [AuthErrorCode, string] {
  if (/rate limit/i.test(message)) {
    return [
      'UNAVAILABLE',
      '가입 요청이 일시적으로 제한되었습니다. 관리자가 Supabase 설정에서 ' +
        '이메일 확인(Confirm email)을 끄면 해결됩니다. ' +
        '잠시 후 다시 시도하거나 운영진에게 문의해 주세요.',
    ];
  }
  if (/already|registered|exists/i.test(message)) {
    return ['ID_TAKEN', '이미 등록된 활동명입니다.'];
  }
  if (/password/i.test(message)) {
    return ['INVALID_INPUT', '비밀번호가 조건을 만족하지 않습니다. 6자 이상 입력하세요.'];
  }
  if (/invalid|email/i.test(message)) {
    return ['INVALID_INPUT', '활동명에 사용할 수 없는 문자가 있습니다. 영문·숫자 위주로 지어 주세요.'];
  }
  return ['INVALID_INPUT', `가입에 실패했습니다: ${message}`];
}

/**
 * 계정 식별자 두 가지.
 *
 * 세션은 uuid 를 주고, 편성(pair_bonds)과 프로필 목록은 활동명을 준다.
 * 어느 쪽이 들어와도 조회가 되어야 하므로 형태를 보고 판별한다.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SheetRow {
  id: string;
  owner: string;
  side: ActorSide;
  name: string;
  class_id: string;
  stats: Record<string, number>;
  skills: CharacterSheet['skills'];
  concept: string;
  affiliation: CharacterSheet['affiliation'];
  created_at: string;
}

function toSheet(row: SheetRow): CharacterSheet {
  return {
    id: row.id,
    side: row.side,
    name: row.name,
    classId: row.class_id,
    stats: row.stats ?? {},
    skills: row.skills ?? [],
    concept: row.concept ?? '',
    affiliation: row.affiliation,
    createdAt: row.created_at,
  };
}

export class SupabaseAuthAdapter implements AuthAdapter {
  async register(input: RegisterInput): Promise<Account> {
    const supabase = requireSupabase();
    const handle = input.id.trim();

    if (handle.length < 2) {
      throw new AuthError('INVALID_INPUT', '활동명은 2자 이상 입력하세요.');
    }
    if (input.password.length < 6) {
      throw new AuthError('INVALID_INPUT', '비밀번호는 6자 이상 입력하세요.');
    }

    const { data, error } = await supabase.auth.signUp({
      email: handleToEmail(handle),
      password: input.password,
      options: { data: { handle } },
    });

    if (error) {
      throw new AuthError(...describeSignUpError(error.message));
    }
    if (!data.user) {
      throw new AuthError('UNAVAILABLE', '가입은 되었지만 세션을 받지 못했습니다. 로그인해 주세요.');
    }

    const { data: sheetRow, error: sheetError } = await supabase
      .from('sheets')
      .insert({
        owner: data.user.id,
        side: input.sheet.side,
        name: input.sheet.name,
        class_id: input.sheet.classId,
        stats: input.sheet.stats,
        skills: input.sheet.skills,
        concept: input.sheet.concept,
        affiliation: input.sheet.affiliation,
      })
      .select()
      .single();

    if (sheetError) {
      throw new AuthError('INVALID_INPUT', `시트 저장 실패: ${sheetError.message}`);
    }

    return {
      id: data.user.id,
      passwordHash: '',
      createdAt: data.user.created_at ?? new Date().toISOString(),
      sheet: toSheet(sheetRow as SheetRow),
    };
  }

  async login(credentials: Credentials): Promise<Session> {
    const supabase = requireSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: handleToEmail(credentials.id),
      password: credentials.password,
    });

    if (error) {
      throw new AuthError('BAD_PASSWORD', '활동명 또는 비밀번호가 일치하지 않습니다.');
    }
    return {
      accountId: data.user.id,
      startedAt: new Date().toISOString(),
    };
  }

  async logout(): Promise<void> {
    await requireSupabase().auth.signOut();
  }

  async currentSession(): Promise<Session | null> {
    const { data } = await requireSupabase().auth.getSession();
    if (!data.session) return null;
    return {
      accountId: data.session.user.id,
      startedAt: new Date(data.session.expires_at ?? 0).toISOString(),
    };
  }

  async getAccount(accountId: string): Promise<Account | null> {
    const supabase = requireSupabase();

    // 활동명으로 불려도 조회가 되어야 한다 — 편성은 활동명으로 계정을 참조한다.
    const userId = UUID_PATTERN.test(accountId)
      ? accountId
      : await this.resolveAccountId(accountId);
    if (!userId) return null;

    const [{ data: profile }, { data: sheetRow }] = await Promise.all([
      supabase.from('profiles').select('id, handle, created_at').eq('id', userId).maybeSingle(),
      supabase.from('sheets').select('*').eq('owner', userId).maybeSingle(),
    ]);

    if (!profile || !sheetRow) return null;

    return {
      // 참가자에게 보이는 식별자는 활동명이다
      id: profile.handle as string,
      passwordHash: '',
      createdAt: (profile.created_at as string) ?? new Date().toISOString(),
      sheet: toSheet(sheetRow as SheetRow),
    };
  }

  async listProfiles(side?: ActorSide): Promise<PublicProfile[]> {
    const supabase = requireSupabase();
    let query = supabase.from('public_profiles').select('account_id, handle, side, name, class_id');
    if (side) query = query.eq('side', side);

    const { data, error } = await query;
    if (error || !data) return [];

    return data.map((row) => ({
      accountId: row.handle as string,
      side: row.side as ActorSide,
      name: row.name as string,
      classId: row.class_id as string,
    }));
  }

  /**
   * 시트 전문 목록 — 운영진만 전체를 받는다.
   *
   * sheets 의 RLS 가 남의 시트를 걸러내므로, 참가자가 호출하면 자기 것만 온다.
   * profiles 는 누구나 읽을 수 있어 활동명 매핑은 여기서 붙인다.
   */
  async listSheets(): Promise<SheetRecord[]> {
    const supabase = requireSupabase();

    const [{ data: sheetRows }, { data: profileRows }] = await Promise.all([
      supabase.from('sheets').select('*').order('created_at', { ascending: true }),
      supabase.from('profiles').select('id, handle'),
    ]);
    if (!sheetRows) return [];

    const handleOf = new Map(
      (profileRows ?? []).map((row) => [row.id as string, row.handle as string]),
    );

    return (sheetRows as SheetRow[]).map((row) => ({
      accountId: handleOf.get(row.owner) ?? row.owner,
      sheet: toSheet(row),
    }));
  }

  async updateSheet(accountId: string, sheet: CharacterSheet): Promise<Account> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from('sheets')
      .update({
        side: sheet.side,
        name: sheet.name,
        class_id: sheet.classId,
        stats: sheet.stats,
        skills: sheet.skills,
        concept: sheet.concept,
        affiliation: sheet.affiliation,
      })
      .eq('id', sheet.id);

    if (error) throw new AuthError('INVALID_INPUT', error.message);

    const account = await this.getAccount(accountId);
    if (!account) throw new AuthError('NOT_FOUND', '계정을 찾을 수 없습니다.');
    return account;
  }

  /**
   * 시트 삭제 — 운영진 전용 (RLS: 본인 또는 운영진).
   * 계정 자체는 남는다. 계정 삭제는 서버 권한이 필요해 대시보드에서 처리한다.
   */
  async deleteSheet(sheetId: string): Promise<void> {
    const { error } = await requireSupabase().from('sheets').delete().eq('id', sheetId);
    if (error) {
      throw new AuthError(
        'UNAVAILABLE',
        `시트를 삭제할 수 없습니다: ${error.message} — 0005 마이그레이션(삭제 정책)을 적용했는지 확인하세요.`,
      );
    }
  }

  async deleteAccount(): Promise<void> {
    // 계정 삭제는 서버 권한이 필요하다 — 운영진이 대시보드에서 처리한다.
    throw new AuthError('UNAVAILABLE', '계정 삭제는 운영진에게 요청해 주세요.');
  }

  /** 이 계정이 운영진인지 */
  async isOperator(): Promise<boolean> {
    const supabase = requireSupabase();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return false;

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .maybeSingle();

    return profile?.role === 'OPERATOR';
  }

  /** 활동명 → 계정 uuid (편성에서 사용) */
  async resolveAccountId(handle: string): Promise<string | null> {
    const { data } = await requireSupabase()
      .from('profiles')
      .select('id')
      .eq('handle', handle)
      .maybeSingle();
    return (data?.id as string) ?? null;
  }
}
