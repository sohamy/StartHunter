/**
 * 저장 · 인증 어댑터 선택 지점.
 *
 * Supabase 환경 변수가 있으면 서버 구현을 쓰고, 없으면 LocalStorage 로 떨어진다.
 * UI 는 언제나 `getStorage()` / `getAuth()` 만 호출한다.
 */

import { LocalAuthAdapter } from './LocalAuthAdapter';
import { LocalStorageAdapter } from './LocalStorageAdapter';
import { SupabaseAuthAdapter } from './SupabaseAuthAdapter';
import { SupabaseStorageAdapter } from './SupabaseStorageAdapter';
import { hasSupabase } from './supabaseClient';
import type { AuthAdapter } from './AuthAdapter';
import type { StorageAdapter } from './StorageAdapter';

let storageAdapter: StorageAdapter | null = null;
let authAdapter: AuthAdapter | null = null;

/** 서버(Supabase)에 연결된 상태인지 — UI 에서 안내 문구를 바꾸는 데 쓴다. */
export function isServerMode(): boolean {
  return hasSupabase();
}

export function getStorage(): StorageAdapter {
  if (!storageAdapter) {
    storageAdapter = hasSupabase() ? new SupabaseStorageAdapter() : new LocalStorageAdapter();
  }
  return storageAdapter;
}

export function getAuth(): AuthAdapter {
  if (!authAdapter) {
    authAdapter = hasSupabase() ? new SupabaseAuthAdapter() : new LocalAuthAdapter();
  }
  return authAdapter;
}

/** 서버 모드일 때만 쓸 수 있는 확장 기능 (실시간 구독 · 쪽별 제출) */
export function getServerStorage(): SupabaseStorageAdapter | null {
  const storage = getStorage();
  return storage instanceof SupabaseStorageAdapter ? storage : null;
}

export function getServerAuth(): SupabaseAuthAdapter | null {
  const auth = getAuth();
  return auth instanceof SupabaseAuthAdapter ? auth : null;
}

/** 테스트나 다른 백엔드 연동 시 구현체를 갈아끼운다. */
export function setStorage(next: StorageAdapter): void {
  storageAdapter = next;
}

export function setAuth(next: AuthAdapter): void {
  authAdapter = next;
}

export { AuthError } from './AuthAdapter';
export type { AuthAdapter, Credentials, PublicProfile, RegisterInput } from './AuthAdapter';
export type { StorageAdapter } from './StorageAdapter';
