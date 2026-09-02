/**
 * 단말 부팅 — 지금 누가 보고 있는가.
 *
 * 참가자 화면은 열릴 때 같은 일을 한다.
 *   세션을 확인하고 → 계정을 읽고 → 없으면 관문(GUEST)을, 있으면 화면(READY)을 띄운다.
 * 창구 화면(보급 상점 · 도박장)은 여기에 하나를 더 본다 — **지금 전투에 배치돼 있는가.**
 * 배치된 동안에는 창구를 닫는다.
 *
 * 이 대여섯 줄이 단말마다 복사돼 있었다. cancelled 가드까지 그대로였고,
 * 그래서 한 곳에서 순서를 고치면 나머지가 조용히 뒤처졌다.
 *
 * 화면마다 더 할 일은 `onReady` 로 받는다 — 계정을 찾은 뒤에 이어서 돈다.
 * 그 안에서는 반드시 `stopped()` 를 확인하고 상태를 건드려야 한다.
 * 화면을 떠난 뒤에 setState 가 불리면 지워진 화면에 값을 쓰는 셈이 된다.
 *
 * **여기에 없는 화면들** — 하는 일이 달라서 억지로 묶지 않았다.
 *   · TerminalNav  접속 여부만 본다. 계정까지 읽으면 모든 화면에서 통신이 한 번 더 는다.
 *   · JoinTerminal 운영자면 작전실로 넘긴다. 관문 화면이라 GUEST/READY 구분이 없다.
 *   · ControlTerminal 운영자 판정이 본체다 (CHECKING · LOCAL · DENIED · GRANTED).
 *   · BattleTerminal 계정 · 상대 목록 · 사진 · 배정된 전투를 **한꺼번에** 세운 뒤 화면을 연다.
 *     중간에 READY 가 되면 배정 대기 화면이 한 번 스쳤다가 전투 화면으로 바뀐다.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import { getAccounts } from '../store';
import { findDeployment } from './deployment';
import { useNotify, type Notifier } from './useNotify';
import type { Account, BattleState } from '../types';

export type SessionPhase = 'LOADING' | 'GUEST' | 'READY';

export interface AccountSession {
  phase: SessionPhase;
  account: Account | null;
  /** 시트가 바뀐 뒤(구매 · 선물 · 회전) 화면이 들고 있는 값을 갈아 끼운다 */
  setAccount: Dispatch<SetStateAction<Account | null>>;
  /** 배치된 전투. `deployment: false` 면 늘 null 이다 */
  deployed: BattleState | null;
  /**
   * 배치 여부를 다시 본다.
   * 화면을 열어 둔 채 배치될 수 있으므로, 창구를 **누르는 순간**에 한 번 더 확인한다.
   */
  refreshDeployment: (accountId: string) => Promise<BattleState | null>;
  /** 탭 제목 뱃지와 브라우저 알림 — 켜는 버튼을 화면에 두려면 이것을 쓴다 */
  notifier: Notifier;
}

export function useAccountSession(
  options: {
    /** 창구 화면이면 켠다 — 배치돼 있으면 문을 닫아야 한다 */
    deployment?: boolean;
    /** 계정을 찾은 뒤 이 화면이 더 할 일 */
    onReady?: (account: Account, stopped: () => boolean) => Promise<void>;
  } = {},
): AccountSession {
  const accounts = useMemo(() => getAccounts(), []);
  const [phase, setPhase] = useState<SessionPhase>('LOADING');
  const [account, setAccount] = useState<Account | null>(null);
  const [deployed, setDeployed] = useState<BattleState | null>(null);

  const { deployment = false } = options;
  /* 매 렌더 새로 만들어지는 함수다 — 의존성에 넣으면 부팅이 계속 다시 돈다 */
  const onReady = useRef(options.onReady);
  onReady.current = options.onReady;

  useEffect(() => {
    let cancelled = false;
    const stopped = () => cancelled;

    void (async () => {
      const session = await accounts.currentSession();
      if (cancelled) return;
      if (!session) {
        setPhase('GUEST');
        return;
      }

      const found = await accounts.getAccount(session.accountId);
      if (cancelled) return;
      setAccount(found);
      setPhase(found ? 'READY' : 'GUEST');
      if (!found) return;

      if (deployment) {
        const joined = await findDeployment(found.id);
        if (cancelled) return;
        setDeployed(joined);
      }

      await onReady.current?.(found, stopped);
    })();

    return () => {
      cancelled = true;
    };
  }, [accounts, deployment]);

  const refreshDeployment = useCallback(async (accountId: string) => {
    const joined = await findDeployment(accountId);
    setDeployed(joined);
    return joined;
  }, []);

  /*
     선물이 왔는지 지켜본다.

     소지금과 가방은 **남이 바꿔 놓을 수 있는** 유일한 내 값이다 — 내가 아무 것도
     하지 않았는데 늘어나 있을 수 있다. 그런데 화면을 계속 보고 있어야만 알았다.

     늘어난 때만 알린다. 줄어드는 것은 내가 산 것이거나 운영진이 회수한 것이고,
     어느 쪽이든 이 화면에서 이미 알고 있다.
  */
  const notifier = useNotify();
  const seenPoints = useRef<number | null>(null);
  const { notify } = notifier;

  useEffect(() => {
    const id = account?.id;
    if (!id) return;

    return accounts.subscribeSheet(id, () => {
      void (async () => {
        const fresh = await accounts.getAccount(id);
        if (!fresh) return;
        setAccount(fresh);

        const before = seenPoints.current;
        const after = fresh.sheet.points ?? 0;
        if (before !== null && after > before) {
          notify('선물이 도착했습니다', `소지금 +${after - before} P — 지금 ${after} P`);
        }
        seenPoints.current = after;
      })();
    });
  }, [account?.id, accounts, notify]);

  /* 처음 읽은 값을 기준선으로 잡는다 — 첫 조회를 「늘어났다」고 보지 않게 */
  useEffect(() => {
    if (account && seenPoints.current === null) seenPoints.current = account.sheet.points ?? 0;
  }, [account]);

  return { phase, account, setAccount, deployed, refreshDeployment, notifier };
}
