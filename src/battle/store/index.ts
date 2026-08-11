/**
 * 저장 · 인증 어댑터 선택 지점.
 *
 * 나중에 Supabase 를 붙일 때 이 파일에서 구현체만 교체한다.
 * UI 는 언제나 `getStorage()` / `getAuth()` 만 호출한다.
 */

import { LocalAuthAdapter } from './LocalAuthAdapter';
import { LocalStorageAdapter } from './LocalStorageAdapter';
import type { AuthAdapter } from './AuthAdapter';
import type { StorageAdapter } from './StorageAdapter';

let storageAdapter: StorageAdapter | null = null;
let authAdapter: AuthAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (!storageAdapter) {
    storageAdapter = new LocalStorageAdapter();
  }
  return storageAdapter;
}

export function getAuth(): AuthAdapter {
  if (!authAdapter) {
    authAdapter = new LocalAuthAdapter();
  }
  return authAdapter;
}

/** 테스트나 서버 연동 시 구현체를 갈아끼운다. */
export function setStorage(next: StorageAdapter): void {
  storageAdapter = next;
}

export function setAuth(next: AuthAdapter): void {
  authAdapter = next;
}

export { AuthError } from './AuthAdapter';
export type { AuthAdapter, Credentials, PublicProfile, RegisterInput } from './AuthAdapter';
export type { StorageAdapter } from './StorageAdapter';
