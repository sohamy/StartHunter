/**
 * 보급 상점 단말 — 참가자용.
 *
 * `/battle/shop/` 으로 연다. 소지금과 가방은 **개인 소유**라
 * 로그인한 계정의 시트에서 그대로 읽는다.
 *
 * 여기서는 사지 않는다. 관리국이 창구에서 처리한다 —
 * 이 화면은 무엇을 얼마에 받을 수 있는지 보여 주고, 내 가방을 확인하는 곳이다.
 */

import { useEffect, useMemo, useState } from 'react';

import { ITEM_CATEGORY_LABELS, describeItem } from '../config/items';
import { shopRows } from '../config/shop';
import { getAuth, loadShopCatalog } from '../store';
import { SupplyBlock } from './SheetView';
import type { Account } from '../types';

type Phase = 'LOADING' | 'READY' | 'GUEST';

function joinUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/battle/join/`;
}

function battleUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/battle/`;
}

export default function ShopTerminal() {
  const auth = useMemo(() => getAuth(), []);
  const [phase, setPhase] = useState<Phase>('LOADING');
  const [account, setAccount] = useState<Account | null>(null);
  /** 진열을 실은 뒤에 그려야 운영진이 넣은 품목이 함께 뜬다 */
  const [catalogReady, setCatalogReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadShopCatalog();
      if (!cancelled) setCatalogReady(true);

      const session = await auth.currentSession();
      if (!session) {
        if (!cancelled) setPhase('GUEST');
        return;
      }
      const found = await auth.getAccount(session.accountId);
      if (cancelled) return;
      setAccount(found);
      setPhase(found ? 'READY' : 'GUEST');
    })();
    return () => {
      cancelled = true;
    };
  }, [auth]);

  if (phase === 'LOADING' || !catalogReady) {
    return <div className="console-loading">OPENING SUPPLY DEPOT…</div>;
  }

  const sheet = account?.sheet ?? null;
  const rows = shopRows();

  return (
    <div className="console">
      <header className="console-head">
        <div className="agency">
          <b>HUNTER MANAGEMENT AGENCY</b>
          <span>SUPPLY DEPOT · 보급 상점</span>
        </div>
        <div className="btn-row">
          <a className="ctl" href={joinUrl()}>
            내 시트
          </a>
          <a className="ctl" href={battleUrl()}>
            전투 단말
          </a>
        </div>
      </header>

      {sheet ? (
        <section className="panel">
          <h2 className="panel-title">
            {sheet.name}
            <span className={`tag ${sheet.side === 'HUNTER' ? 'blue' : 'gold'}`} style={{ marginLeft: 10 }}>
              {sheet.side === 'HUNTER' ? '헌터' : '성좌'}
            </span>
          </h2>
          <SupplyBlock supply={{ points: sheet.points ?? 0, inventory: sheet.inventory ?? [] }} />
          <p className="hint" style={{ marginTop: 12 }}>
            소지금과 가방은 개인 것입니다. 구매 · 반납은 관리국 보급 창구에서 처리합니다 —
            필요한 품목을 관리국에 요청하세요. 전투 중에는 살 수 없습니다.
          </p>
        </section>
      ) : (
        <section className="panel">
          <h2 className="panel-title">가격표만 보고 있습니다</h2>
          <p className="hint" style={{ marginBottom: 12 }}>
            접속하면 소지금과 내 가방이 함께 뜹니다.
          </p>
          <a className="confirm-btn" href={joinUrl()}>
            접속하기
            <small>계약 등록 단말로 이동</small>
          </a>
        </section>
      )}

      <section className="panel">
        <h2 className="panel-title">CATALOG · 진열 {rows.length}</h2>
        {rows.length === 0 ? (
          <p className="dim">진열된 품목이 없습니다.</p>
        ) : (
          <ul className="shop-list">
            {rows.map((row) => {
              const owned =
                (sheet?.inventory ?? []).find((stack) => stack.itemId === row.itemId)?.quantity ?? 0;
              const affordable = (sheet?.points ?? 0) >= row.price;
              return (
                <li key={row.itemId}>
                  <span className="shop-name">
                    {row.item.nameKo}
                    <small className="dim">
                      {describeItem(row.item).join(' / ') || row.item.description}
                    </small>
                  </span>
                  <span className="tag">{ITEM_CATEGORY_LABELS[row.item.category].labelKo}</span>
                  <b className={`num ${sheet && !affordable ? 'dim' : 'gold'}`}>{row.price} P</b>
                  <span className="tag">
                    보유 {owned}
                    {row.limit !== null ? ` / ${row.limit}` : ''}
                  </span>
                  {!row.item.combatUsable && <span className="tag warn">전투 중 사용 불가</span>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <footer className="console-foot">
        <span>HUNTER MANAGEMENT AGENCY · SUPPLY DEPOT</span>
        <a href={joinUrl()}>← 내 시트</a>
      </footer>
    </div>
  );
}
