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
  type Credentials,
  type PublicProfile,
  type RegisterInput,
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
      const taken = /already|registered|exists/i.test(error.message);
      throw new AuthError(taken ? 'ID_TAKEN' : 'INVALID_INPUT', error.message);
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

    const [{ data: profile }, { data: sheetRow }] = await Promise.all([
      supabase.from('profiles').select('id, handle, created_at').eq('id', accountId).maybeSingle(),
      supabase.from('sheets').select('*').eq('owner', accountId).maybeSingle(),
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
