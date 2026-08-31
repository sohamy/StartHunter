/**
 * 보급 상점 단말 — 참가자용.
 *
 * `/battle/shop/` 으로 연다. 소지금과 가방은 **개인 소유**라
 * 로그인한 계정의 시트에서 그대로 읽는다.
 *
 * 참가자가 직접 산다. 다만 **전투에 배치된 동안에는 살 수 없다** —
 * 보급은 전투 밖에서만 갖춘다.
 *
 * 값 계산과 최종 판정은 서버(`shop_trade`)가 한다.
 * 이 화면이 하는 판정은 버튼을 미리 잠그기 위한 것이고, 통과 여부는 서버가 정한다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ITEM_CATEGORY_LABELS, describeItem } from '../config/items';
import { shopRows } from '../config/shop';
import { REFUND_RATIO } from '../engine/shop';
import { getAuth, getStorage, loadShopCatalog } from '../store';
import { SupplyBlock } from './SheetView';
import type { Account, BattleState } from '../types';

type Phase = 'LOADING' | 'READY' | 'GUEST';

function joinUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/battle/join/`;
}

function battleUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/battle/`;
}

/**
 * 이 계정이 지금 어느 전투에 배치돼 있는지.
 * 끝난 전투는 세지 않는다 — 정산이 끝나면 다시 살 수 있어야 한다.
 */
async function findDeployment(accountId: string): Promise<BattleState | null> {
  const storage = getStorage();
  for (const summary of await storage.listBattles()) {
    if (summary.status === 'CLEARED' || summary.status === 'FAILED') continue;
    const candidate = await storage.loadBattle(summary.id);
    if (!candidate) continue;
    const mine = candidate.pairs.some(
      (pair) => pair.hunterAccountId === accountId || pair.constellationAccountId === accountId,
    );
    if (mine) return candidate;
  }
  return null;
}

export default function ShopTerminal() {
  const auth = useMemo(() => getAuth(), []);
  const [phase, setPhase] = useState<Phase>('LOADING');
  const [account, setAccount] = useState<Account | null>(null);
  /** 진열을 실은 뒤에 그려야 운영진이 넣은 품목이 함께 뜬다 */
  const [catalogReady, setCatalogReady] = useState(false);
  /** 배치된 전투 — 있으면 창구를 닫는다 */
  const [deployed, setDeployed] = useState<BattleState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

      if (found) {
        const joined = await findDeployment(found.id);
        if (!cancelled) setDeployed(joined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth]);

  /** 구매 · 반납은 같은 길을 탄다 — 결과를 내 시트에 그대로 쓴다 */
  const trade = useCallback(
    async (itemId: string, kind: 'BUY' | 'SELL') => {
      if (!account) return;
      setMessage(null);
      setError(null);

      // 화면을 열어 둔 채 배치되었을 수 있다 — 누를 때 한 번 더 확인한다
      const joined = await findDeployment(account.id);
      setDeployed(joined);
      if (joined) {
        setError('전투에 배치된 동안에는 보급을 살 수 없습니다. 전투가 끝난 뒤에 오세요.');
        return;
      }

      setBusy(true);
      try {
        // 값 계산과 최종 판정은 서버가 한다 — 브라우저는 무엇을 사고팔지만 보낸다
        const wallet = await auth.tradeItem(itemId, kind);
        setAccount({
          ...account,
          sheet: { ...account.sheet, points: wallet.points, inventory: wallet.inventory },
        });
        setMessage(
          kind === 'BUY'
            ? `구매 완료 — 남은 소지금 ${wallet.points} P`
            : `반납 완료 — 남은 소지금 ${wallet.points} P`,
        );
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : '처리하지 못했습니다.');
      } finally {
        setBusy(false);
      }
    },
    [account, auth],
  );

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
          {deployed ? (
            <p className="notice warn" style={{ marginTop: 12 }}>
              <b>{deployed.operation.name}</b> 에 배치되어 있습니다 — 전투가 끝날 때까지 보급을 살
              수 없습니다. 가방에 있는 것은 전투 화면에서 그대로 씁니다.
            </p>
          ) : (
            <p className="hint" style={{ marginTop: 12 }}>
              소지금과 가방은 <b>개인 소유</b>입니다 — 페어와 나누지 않습니다. 여기서 직접 사고
              반납할 수 있고, 반납은 구매가의 절반을 돌려줍니다. 전투에 배치되면 창구가 닫힙니다.
            </p>
          )}
          {message && <p className="notice ok" style={{ marginTop: 10 }}>{message}</p>}
          {error && <p className="notice warn" style={{ marginTop: 10 }}>{error}</p>}
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

      <section className="panel depot">
        <div className="process-head">
          <h2 className="panel-title">CATALOG · 진열 {rows.length}</h2>
          {sheet && (
            <span className={`tag ${deployed ? 'critical' : 'ok'}`}>
              {deployed ? '창구 닫힘 — 전투 배치 중' : '창구 열림'}
            </span>
          )}
        </div>

        {/* 반납 값은 규칙이라 진열 위에 못 박아 둔다 — 눌러 보고 알게 하지 않는다 */}
        <p className="notice depot-notice">
          <b>보급 규칙</b> — 관리국은 반납품을 <b>구매가의 절반</b>에 다시 사들입니다 (원 단위
          내림). 품목마다 보유 한도가 있으며, 전투에 배치된 동안에는 사고팔 수 없습니다.
        </p>

        {rows.length === 0 ? (
          <p className="dim">진열된 품목이 없습니다.</p>
        ) : (
          <ul className="depot-grid">
            {rows.map((row) => {
              const owned =
                (sheet?.inventory ?? []).find((stack) => stack.itemId === row.itemId)?.quantity ?? 0;
              const affordable = (sheet?.points ?? 0) >= row.price;
              const full = row.limit !== null && owned >= row.limit;
              const back = Math.floor(row.price * REFUND_RATIO);
              const effects = describeItem(row.item);

              return (
                <li
                  key={row.itemId}
                  className={`depot-card cat-${row.item.category.toLowerCase()} ${
                    owned > 0 ? 'owned' : ''
                  }`}
                >
                  <div className="depot-card-head">
                    <span className="depot-code">{row.item.name || row.itemId}</span>
                    <span className="tag">{ITEM_CATEGORY_LABELS[row.item.category].labelKo}</span>
                  </div>

                  <b className="depot-name">{row.item.nameKo}</b>
                  <p className="depot-desc">{row.item.description}</p>

                  {effects.length > 0 && (
                    <ul className="depot-effects">
                      {effects.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}

                  <div className="depot-meta">
                    <span className="num">AP {row.item.apCost}</span>
                    {!row.item.combatUsable && <span className="tag warn">전투 중 사용 불가</span>}
                    {owned > 0 && <span className="tag ok">보유 {owned}</span>}
                    <span className="depot-limit num">
                      한도 {row.limit === null ? '없음' : `${owned} / ${row.limit}`}
                    </span>
                  </div>

                  <div className="depot-price">
                    <b className={`num ${sheet && !affordable ? 'danger-text' : 'gold'}`}>
                      {row.price} P
                    </b>
                    <span className="depot-back num">반납 +{back} P</span>
                  </div>

                  {sheet ? (
                    <div className="depot-actions">
                      <button
                        type="button"
                        className="ctl primary"
                        disabled={busy || deployed !== null || !affordable || full}
                        title={
                          deployed
                            ? '전투에 배치된 동안에는 살 수 없습니다'
                            : full
                              ? '보유 한도를 채웠습니다'
                              : !affordable
                                ? '소지금이 부족합니다'
                                : undefined
                        }
                        onClick={() => void trade(row.itemId, 'BUY')}
                      >
                        구매 −{row.price} P
                      </button>
                      <button
                        type="button"
                        className="ctl"
                        disabled={busy || deployed !== null || owned <= 0}
                        title={`반납하면 ${back} P 를 돌려받습니다`}
                        onClick={() => void trade(row.itemId, 'SELL')}
                      >
                        반납 +{back} P
                      </button>
                    </div>
                  ) : (
                    <div className="depot-actions">
                      <a className="ctl" href={joinUrl()}>
                        접속하고 구매하기
                      </a>
                    </div>
                  )}
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
