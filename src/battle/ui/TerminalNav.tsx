/**
 * 단말 공통 내비게이션 — 모든 콘솔 화면의 맨 위에 얹는다.
 *
 * 화면마다 머리에 붙여 둔 링크가 제각각이라(상점에는 도박장이 있고 도박장에는 전투 단말이
 * 없는 식) 한 곳에서 다른 곳으로 가려면 되돌아 나와야 했다. 갈 수 있는 곳을 한 줄로
 * 모아 두고, 지금 보고 있는 곳을 표시한다.
 *
 * 접속 여부에 따라 줄이 바뀐다 — 로그인하지 않은 사람에게 「전투 단말 · 상점」을 내밀면
 * 눌러도 접속 안내만 나오므로, 그때는 명부와 두 관문만 보여 준다.
 * 운영자 항목은 운영자에게만 뜬다.
 */

import { useEffect, useState } from 'react';

import { getAccounts, getServerAccounts } from '../store';
import type { ActorSide } from '../types';

/** 어느 화면을 보고 있는지 — 그 항목을 현재 위치로 표시한다 */
export type NavKey =
  | 'home'
  | 'sheet'
  | 'battle'
  | 'shop'
  | 'roulette'
  | 'roster'
  | 'control'
  /** 남의 공개 시트 — 명부에서 들어온 자리이므로 명부를 켜 둔다 */
  | 'public-sheet';

interface NavItem {
  key: NavKey;
  label: string;
  sub: string;
  path: string;
  /** 접속한 사람에게만 보여 줄 항목 */
  private?: boolean;
}

const ITEMS: NavItem[] = [
  { key: 'home', label: '세계관', sub: 'WORLD', path: '' },
  { key: 'sheet', label: '내 시트', sub: 'SHEET', path: '/battle/join/', private: true },
  { key: 'battle', label: '전투 단말', sub: 'RAID', path: '/battle/', private: true },
  { key: 'shop', label: '보급 상점', sub: 'SUPPLY', path: '/battle/shop/', private: true },
  { key: 'roulette', label: '도박장', sub: 'FORTUNE', path: '/battle/roulette/', private: true },
  { key: 'roster', label: '명부 게시판', sub: 'ROSTER', path: '/battle/board/' },
];

function base(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, '');
}

function urlOf(item: NavItem): string {
  return `${base()}${item.path}` || '/';
}

/** 지금 접속한 사람 — 화면이 이미 들고 있으면 넘겨받는다 (없으면 표시하지 않는다) */
export interface NavWho {
  name: string;
  side: ActorSide;
}

export default function TerminalNav({
  current,
  who,
}: {
  current: NavKey;
  who?: NavWho | null;
}) {
  /** null = 아직 확인 중 — 확인이 끝나기 전에 관문을 띄우면 줄이 두 번 바뀐다 */
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [operator, setOperator] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await getAccounts().currentSession();
      if (cancelled) return;
      setSignedIn(!!session);
      if (!session) return;

      // 운영자 판정은 서버 모드에서만 있다
      try {
        const server = getServerAccounts();
        if (server && (await server.isOperator()) && !cancelled) setOperator(true);
      } catch {
        /* 판정 실패는 참가자로 본다 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = async () => {
    await getAccounts().logout();
    window.location.href = `${base()}/battle/join/?mode=login`;
  };

  // 접속 여부를 확인하기 전에는 누구나 볼 수 있는 항목만 그린다
  const listed = ITEMS.filter((item) => !item.private || signedIn === true);
  const active = current === 'public-sheet' ? 'roster' : current;

  return (
    <nav className="term-nav" aria-label="단말 이동">
      <a className="term-nav-brand" href={urlOf(ITEMS[0])}>
        <span aria-hidden="true">✦</span> HMA
      </a>

      <div className="term-nav-links">
        {listed.map((item) => {
          const on = item.key === active;
          return (
            <a
              key={item.key}
              className={`term-nav-link ${on ? 'on' : ''}`}
              href={urlOf(item)}
              aria-current={on ? 'page' : undefined}
            >
              <b>{item.label}</b>
              <small>{item.sub}</small>
            </a>
          );
        })}
        {operator && (
          <a
            className={`term-nav-link staff ${current === 'control' ? 'on' : ''}`}
            href={`${base()}/battle/control/`}
            aria-current={current === 'control' ? 'page' : undefined}
          >
            <b>작전실</b>
            <small>CONTROL</small>
          </a>
        )}
      </div>

      <div className="term-nav-side">
        {signedIn === true ? (
          <>
            {who && (
              <span className="term-nav-who">
                <span className={`tag ${who.side === 'HUNTER' ? 'blue' : 'gold'}`}>
                  {who.side === 'HUNTER' ? '헌터' : '성좌'}
                </span>
                <b>{who.name}</b>
              </span>
            )}
            <button type="button" className="ctl small" onClick={() => void logout()}>
              로그아웃
            </button>
          </>
        ) : (
          signedIn === false && (
            <>
              <a className="ctl small" href={`${base()}/battle/join/?mode=login`}>
                로그인
              </a>
              <a className="ctl small primary" href={`${base()}/battle/join/?mode=register`}>
                시트 작성
              </a>
            </>
          )
        )}
      </div>
    </nav>
  );
}
