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

import { ITEM_CATEGORY_LABELS, describeItem, findItem, statGainOf, statLabel } from '../config/items';
import { SHOP_NPC } from '../config/npc';
import { shopRows } from '../config/shop';
import { REFUND_RATIO } from '../engine/shop';
import { getAuth, loadShopCatalog } from '../store';
import { findDeployment } from './deployment';
import NpcCard from './NpcCard';
import { SupplyBlock } from './SheetView';
import type { Account, BattleState, ItemStack } from '../types';

type GiftKind = 'POINTS' | 'ITEM';

type Phase = 'LOADING' | 'READY' | 'GUEST';

function joinUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/battle/join/`;
}

function battleUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/battle/`;
}

function rouletteUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/battle/roulette/`;
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

  /* ── 선물하기 ─────────────────────────────────────── */
  const [giftName, setGiftName] = useState('');
  const [giftKind, setGiftKind] = useState<GiftKind>('POINTS');
  const [giftItemId, setGiftItemId] = useState('');
  const [giftAmount, setGiftAmount] = useState(1);
  /** 이름을 확인한 결과 — 누구에게 보내는지 눈으로 보고 누르게 한다 */
  const [giftTarget, setGiftTarget] = useState<string | null>(null);

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

  /** 이름이 실제로 있는지 미리 확인한다 — 눌러 보고 알게 하지 않는다 */
  const lookupGiftTarget = useCallback(async () => {
    const name = giftName.trim();
    setGiftTarget(null);
    if (!name) return;
    try {
      const found = await auth.findGiftTarget(name);
      if (found) {
        setGiftTarget(`${found.name} · ${found.side === 'HUNTER' ? '헌터' : '성좌'}`);
      } else {
        setError('그런 이름의 참가자를 찾을 수 없습니다.');
      }
    } catch {
      // 조회에 실패해도 보내기는 서버가 다시 판정한다 — 여기서 막지 않는다
    }
  }, [auth, giftName]);

  const sendGift = useCallback(async () => {
    if (!account) return;
    setMessage(null);
    setError(null);

    const name = giftName.trim();
    if (!name) {
      setError('받는 사람의 이름을 입력하세요.');
      return;
    }
    if (giftKind === 'ITEM' && !giftItemId) {
      setError('보낼 보급품을 고르세요.');
      return;
    }
    const amount = Math.floor(giftAmount);
    if (amount < 1) {
      setError('1 이상을 보내세요.');
      return;
    }

    setBusy(true);
    try {
      const result = await auth.giftTo({
        toName: name,
        kind: giftKind,
        itemId: giftKind === 'ITEM' ? giftItemId : null,
        amount,
      });
      setAccount({
        ...account,
        sheet: { ...account.sheet, points: result.points, inventory: result.inventory },
      });
      setMessage(
        giftKind === 'POINTS'
          ? `${result.toName} 에게 ${amount} P 를 보냈습니다 — 남은 소지금 ${result.points} P`
          : `${result.toName} 에게 ${findItem(giftItemId)?.nameKo ?? giftItemId} ${amount}개를 보냈습니다.`,
      );
      setGiftAmount(1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '보내지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }, [account, auth, giftAmount, giftItemId, giftKind, giftName]);

  /** 강화 아이템 사용 — 전투 밖에서만, 능력치가 영구히 오른다 */
  const useItem = useCallback(
    async (itemId: string) => {
      if (!account) return;
      setMessage(null);
      setError(null);
      setBusy(true);
      try {
        const result = await auth.useSupply(itemId);
        setAccount({
          ...account,
          sheet: {
            ...account.sheet,
            statBonus: result.statBonus,
            inventory: result.inventory,
          },
        });
        const gained = Object.entries(statGainOf(findItem(itemId)) ?? {})
          .map(([key, amount]) => `${statLabel(key)} +${amount}`)
          .join(' · ');
        setMessage(`${findItem(itemId)?.nameKo ?? itemId} 사용 — ${gained} (영구)`);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : '쓰지 못했습니다.');
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

  /** 가방에 있는 것 중 지금 쓸 수 있는 강화 보급품 */
  const usableRows = (sheet?.inventory ?? []).flatMap((stack: ItemStack) => {
    const item = findItem(stack.itemId);
    const gain = statGainOf(item);
    if (!item || !gain || item.combatUsable || stack.quantity <= 0) return [];
    return [{ item, quantity: stack.quantity, gain }];
  });

  return (
    <div className="console">
      <header className="console-head">
        <div className="agency">
          <b>HUNTER MANAGEMENT AGENCY</b>
          <span>SUPPLY DEPOT · 보급 상점</span>
        </div>
        <div className="btn-row">
          <a className="ctl" href={rouletteUrl()}>
            도박장
          </a>
          <a className="ctl" href={joinUrl()}>
            내 시트
          </a>
          <a className="ctl" href={battleUrl()}>
            전투 단말
          </a>
        </div>
      </header>

      {/* 창구에 사람이 하나 서 있다 — 판정에는 관여하지 않고 사정만 말해 준다 */}
      <section className="panel hall">
        <NpcCard
          npc={SHOP_NPC}
          mood={deployed ? 'CLOSED' : error ? 'BAD' : message ? 'OK' : 'IDLE'}
          seed={(sheet?.inventory ?? []).length + (sheet?.points ?? 0)}
        />
      </section>

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

      {sheet && (
        <section className="panel">
          <h2 className="panel-title">강화 · 사용</h2>
          <p className="hint" style={{ marginBottom: 10 }}>
            능력치를 올려 주는 보급품은 <b>여기서 씁니다</b> — 전투 중에는 쓸 수 없고, 한 번 쓰면
            시트에 영구히 남습니다. 올라간 값은 배분 점수와 따로 셉니다.
          </p>
          {usableRows.length === 0 ? (
            <p className="dim">쓸 수 있는 강화 보급품이 가방에 없습니다.</p>
          ) : (
            <ul className="shop-list">
              {usableRows.map(({ item, quantity, gain }) => (
                <li key={item.id}>
                  <span className="shop-name">
                    {item.nameKo}
                    <small className="dim">
                      {Object.entries(gain)
                        .map(([key, amount]) => {
                          const now = sheet.statBonus?.[key] ?? 0;
                          const cap = item.effect.statCap;
                          return `${statLabel(key)} +${amount} · 지금 +${now}${
                            cap ? ` / 상한 +${cap}` : ''
                          }`;
                        })
                        .join(' · ')}
                    </small>
                  </span>
                  <span className="tag ok">보유 {quantity}</span>
                  <button
                    type="button"
                    className="ctl small primary"
                    disabled={busy || deployed !== null}
                    title={
                      deployed ? '전투에 배치된 동안에는 쓸 수 없습니다' : '한 개를 써서 강화합니다'
                    }
                    onClick={() => void useItem(item.id)}
                  >
                    사용
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {sheet && (
        <section className="panel">
          <h2 className="panel-title">선물하기</h2>
          <p className="hint" style={{ marginBottom: 10 }}>
            받는 사람의 <b>이름</b>(헌터 이름 · 성좌의 성호)을 적으면 소지금이나 보급품을 넘길
            수 있습니다. 이름은 참가자마다 하나뿐입니다. 되돌릴 수 없으니 누구인지 확인하고
            보내세요. 전투에 배치된 동안에는 창구가 닫힙니다.
          </p>

          <div className="admin-grid">
            <label className="input-row">
              <span className="field-label">받는 사람 이름</span>
              <input
                className="ctl input"
                value={giftName}
                placeholder="예: 서리매듭"
                onChange={(event) => {
                  setGiftName(event.target.value);
                  setGiftTarget(null);
                }}
                onBlur={() => void lookupGiftTarget()}
              />
            </label>

            <label className="input-row">
              <span className="field-label">무엇을</span>
              <select
                className="ctl input"
                value={giftKind}
                onChange={(event) => setGiftKind(event.target.value as GiftKind)}
              >
                <option value="POINTS">소지금 (P)</option>
                <option value="ITEM">보급품</option>
              </select>
            </label>

            {giftKind === 'ITEM' && (
              <label className="input-row">
                <span className="field-label">보낼 품목</span>
                <select
                  className="ctl input"
                  value={giftItemId}
                  onChange={(event) => setGiftItemId(event.target.value)}
                >
                  <option value="">가방에서 고르기…</option>
                  {(sheet.inventory ?? [])
                    .filter((stack: ItemStack) => stack.quantity > 0)
                    .map((stack: ItemStack) => (
                      <option key={stack.itemId} value={stack.itemId}>
                        {findItem(stack.itemId)?.nameKo ?? stack.itemId} · 보유 {stack.quantity}
                      </option>
                    ))}
                </select>
              </label>
            )}

            <label className="input-row">
              <span className="field-label">
                {giftKind === 'POINTS' ? '금액 (P)' : '개수'}
              </span>
              <input
                className="ctl input"
                type="number"
                min={1}
                step={giftKind === 'POINTS' ? 10 : 1}
                value={giftAmount}
                onChange={(event) => setGiftAmount(Number(event.target.value))}
              />
            </label>
          </div>

          {giftTarget && (
            <p className="notice ok" style={{ marginTop: 10 }}>
              받는 사람 — <b>{giftTarget}</b>
            </p>
          )}

          <div className="btn-row" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="ctl primary"
              disabled={busy || deployed !== null || giftName.trim().length === 0}
              title={deployed ? '전투에 배치된 동안에는 보낼 수 없습니다' : undefined}
              onClick={() => void sendGift()}
            >
              {busy ? '보내는 중…' : '보내기'}
            </button>
            <span className="hint">
              {giftKind === 'POINTS'
                ? `내 소지금 ${sheet.points ?? 0} P`
                : '받는 쪽의 보유 한도를 넘으면 거절됩니다.'}
            </span>
          </div>
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
