/**
 * 저장 어댑터 선택 지점.
 *
 * 나중에 Supabase 를 붙일 때 이 파일에서 구현체만 교체한다.
 * UI 는 언제나 `getStorage()` 만 호출한다.
 */

import { LocalStorageAdapter } from './LocalStorageAdapter';
import type { StorageAdapter } from './StorageAdapter';

let adapter: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (!adapter) {
    adapter = new LocalStorageAdapter();
  }
  return adapter;
}

/** 테스트나 서버 연동 시 구현체를 갈아끼운다. */
export function setStorage(next: StorageAdapter): void {
  adapter = next;
}

export type { StorageAdapter } from './StorageAdapter';
