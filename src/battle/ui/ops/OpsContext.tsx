/**
 * 작전실 공용 배선.
 *
 * 탭마다 필요한 것은 다르지만, **어떤 탭이든 똑같이 쓰는 것들**이 있다 —
 * 저장소·인증 어댑터, 실패를 삼키지 않는 guard, 알림 줄, 목록 새로고침.
 * 이것들을 탭마다 props 로 내려보내면 탭 하나 늘 때마다 배선이 여덟 줄씩 늘어난다.
 *
 * 그래서 배선은 여기로 걷어 두고, **도메인 데이터는 props 로 내려보낸다** —
 * 무엇이 무엇에 쓰이는지는 여전히 눈에 보여야 하기 때문이다.
 */

import { createContext, useContext, type ReactNode } from 'react';

import type { AuthAdapter, StorageAdapter } from '../../store';

export interface OpsShell {
  storage: StorageAdapter;
  auth: AuthAdapter;
  /** 저장·통신이 도는 중인지 — 버튼을 잠그는 데 쓴다 */
  busy: boolean;
  /** guard 를 쓸 수 없는 긴 작업(전투 시작처럼)에서 직접 잠근다 */
  setBusy: (value: boolean) => void;
  /** 실패를 화면에 띄우고 busy 를 되돌린다. 조용히 삼키지 않는다. */
  guard: (task: () => Promise<void>) => Promise<void>;
  /** 목록 전체를 다시 읽는다 */
  refresh: () => Promise<void>;
  /** 스스로 사라지는 알림 */
  setMessage: (text: string | null) => void;
  /** 남는 오류 */
  setError: (text: string | null) => void;
  copyText: (text: string) => Promise<void>;
}

const Ops = createContext<OpsShell | null>(null);

export function OpsProvider({ value, children }: { value: OpsShell; children: ReactNode }) {
  return <Ops.Provider value={value}>{children}</Ops.Provider>;
}

/** 작전실 밖에서 부르면 곧바로 터진다 — 조용히 undefined 가 흐르는 편보다 낫다 */
export function useOps(): OpsShell {
  const shell = useContext(Ops);
  if (!shell) throw new Error('useOps 는 OpsProvider 안에서만 쓸 수 있습니다.');
  return shell;
}
