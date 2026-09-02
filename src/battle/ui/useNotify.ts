/**
 * 알림 — 화면을 보고 있지 않은 사람에게 알린다.
 *
 * 지금까지는 폴링이 돌면서 화면을 갱신하기만 했다. 내 차례가 왔는지, 라운드가
 * 처리됐는지, 선물이 왔는지를 **화면을 계속 들여다봐야만** 알 수 있었다.
 *
 * 두 갈래로 알린다.
 *   · 탭 제목에 수를 붙인다 — 「(1) 전투 단말」. 권한도 설치도 필요 없고,
 *     탭이 뒤에 깔려 있어도 보인다. 이것만으로도 체감이 크게 달라진다.
 *   · 브라우저 알림 — **사람이 버튼을 눌러 켠 뒤에만** 쓴다.
 *     화면이 열릴 때 자동으로 권한을 물으면 대부분 거절부터 하고, 한 번 거절하면
 *     다시 물을 수 없다.
 *
 * 보고 있는 화면에는 알리지 않는다(document.hidden). 눈앞에서 벌어지는 일에
 * 뱃지를 붙이면 그건 알림이 아니라 잡음이다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type NotifyPermission = 'unsupported' | 'default' | 'granted' | 'denied';

export interface Notifier {
  /** 못 본 알림 수. 탭 제목에 붙는다 */
  pending: number;
  /** 알릴 일이 생겼다. 화면을 보고 있으면 아무 일도 하지 않는다 */
  notify: (title: string, body: string) => void;
  /** 브라우저 알림을 쓸 수 있는지 */
  permission: NotifyPermission;
  /** **사람이 버튼을 눌렀을 때만** 부른다 */
  ask: () => Promise<void>;
}

function currentPermission(): NotifyPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as NotifyPermission;
}

export function useNotify(): Notifier {
  const [pending, setPending] = useState(0);
  const [permission, setPermission] = useState<NotifyPermission>('default');

  /* 원래 제목 — 뱃지를 떼면 이 값으로 돌아간다 */
  const baseTitle = useRef('');

  useEffect(() => {
    baseTitle.current = document.title;
    setPermission(currentPermission());
  }, []);

  /* 화면으로 돌아오면 본 것으로 친다 */
  useEffect(() => {
    const seen = () => {
      if (!document.hidden) setPending(0);
    };
    document.addEventListener('visibilitychange', seen);
    window.addEventListener('focus', seen);
    return () => {
      document.removeEventListener('visibilitychange', seen);
      window.removeEventListener('focus', seen);
    };
  }, []);

  useEffect(() => {
    if (!baseTitle.current) return;
    document.title = pending > 0 ? `(${pending}) ${baseTitle.current}` : baseTitle.current;
  }, [pending]);

  /* 화면을 떠날 때 제목을 되돌린다 — 뱃지가 남은 채로 다른 곳에 가지 않게 */
  useEffect(
    () => () => {
      if (baseTitle.current) document.title = baseTitle.current;
    },
    [],
  );

  const notify = useCallback((title: string, body: string) => {
    if (typeof document === 'undefined' || !document.hidden) return;
    setPending((count) => count + 1);

    if (currentPermission() !== 'granted') return;
    try {
      /*
         tag 를 주면 같은 종류의 알림이 쌓이지 않고 마지막 것으로 덮인다 —
         자리를 비운 사이에 라운드가 세 번 돌았다고 알림이 세 개 쌓일 이유는 없다.
      */
      new Notification(title, { body, tag: title });
    } catch {
      // 알림을 못 띄워도 제목 뱃지는 이미 올라갔다
    }
  }, []);

  const ask = useCallback(async () => {
    if (currentPermission() === 'unsupported') return;
    try {
      setPermission((await Notification.requestPermission()) as NotifyPermission);
    } catch {
      setPermission(currentPermission());
    }
  }, []);

  return { pending, notify, permission, ask };
}
