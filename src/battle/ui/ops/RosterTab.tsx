/**
 * 영구 편성 명부 탭.
 *
 * 페어는 한 번 맺으면 전투가 끝나도 유지된다 — 전투 편성과는 다른 층위다.
 *
 * 짝을 짓는 길은 둘이다.
 *   · 참가자가 적어 낸 **페어명**으로 묶는다 (같은 이름을 쓴 사람끼리)
 *   · 운영진이 두 사람을 직접 고른다
 * 앞의 길이 기본이다 — 상대를 정하고 온 사람이 대부분이기 때문이다.
 */

import { useState } from 'react';

import { describeItem } from '../../config/items';
import { shopRows } from '../../config/shop';
import { REFUND_RATIO } from '../../engine/shop';
import Collapsible from '../Collapsible';
import { SheetDetail, sideLabel } from '../SheetView';
import { useOps } from './OpsContext';
import { NumberField, TextField, confirmed, newId } from './shared';
import { useSheetAdmin } from './useSheetAdmin';
import type { PublicProfile, SheetRecord } from '../../store';
import type { ActorSide, CharacterSheet, PairBond } from '../../types';

export default function RosterTab({
  bonds,
  activeBonds,
  profiles,
  sheets,
  sheetOf,
}: {
  bonds: PairBond[];
  activeBonds: PairBond[];
  profiles: PublicProfile[];
  sheets: SheetRecord[];
  sheetOf: (accountId: string | null) => CharacterSheet | null;
}) {
  const ops = useOps();
  const { storage, busy, guard, refresh, setMessage, setError } = ops;
  const { saveSheet, buyForSheet, sellForSheet } = useSheetAdmin(ops);
  const [pairingHunter, setPairingHunter] = useState('');
  const [pairingConstellation, setPairingConstellation] = useState('');

  /**
   * 페어를 맺는다.
   * 인자를 주지 않으면 위쪽 선택칸의 값을 쓴다 — 페어명 묶음에서는 곧바로 넘긴다.
   */
  const createBond = async (
    hunterId: string = pairingHunter,
    constellationId: string = pairingConstellation,
  ) => {
    if (!hunterId || !constellationId) {
      setError('헌터와 성좌를 모두 선택하세요.');
      return;
    }
    if (hunterId === constellationId) {
      setError('한 참가자가 양쪽을 맡을 수 없습니다.');
      return;
    }

    const hunter = profiles.find((row) => row.accountId === hunterId);
    const constellation = profiles.find((row) => row.accountId === constellationId);
    const taken = bonds.find(
      (row) =>
        row.active &&
        (row.hunterAccountId === hunterId || row.constellationAccountId === constellationId),
    );
    if (taken) {
      setError(`이미 ${taken.label} 에 편성된 참가자가 있습니다. 먼저 해산하세요.`);
      return;
    }

    // 두 사람이 적어 둔 페어명을 그대로 쓴다 — 없으면 일련번호로 붙인다
    const written = (hunter?.pairName ?? '').trim() || (constellation?.pairName ?? '').trim();
    const bond: PairBond = {
      id: newId(),
      label:
        written ||
        `PAIR ${String(bonds.filter((row) => row.active).length + 1).padStart(2, '0')}`,
      hunterAccountId: hunterId,
      constellationAccountId: constellationId,
      hunterName: hunter?.name ?? pairingHunter,
      constellationName: constellation?.name ?? pairingConstellation,
      affiliation: 'GOVERNMENT',
      active: true,
      createdAt: new Date().toISOString(),
    };

    await guard(async () => {
      await storage.saveBond(bond);
      await refresh();
      setPairingHunter('');
      setPairingConstellation('');
      setMessage(`${bond.label} 편성 완료 — 이 페어는 공략 내내 유지됩니다.`);
    });
  };

  const patchBond = async (bond: PairBond, patch: Partial<PairBond>) => {
    await guard(async () => {
      await storage.saveBond({ ...bond, ...patch });
      await refresh();
    });
  };

  const unpaired = profiles.filter(
    (profile) =>
      !activeBonds.some(
        (bond) =>
          bond.hunterAccountId === profile.accountId ||
          bond.constellationAccountId === profile.accountId,
      ),
  );

  /**
   * 참가자가 적어 낸 페어명으로 묶는다.
   *
   * 같은 이름을 적은 사람끼리 짝이 된다 — 띄어쓰기와 대소문자는 무시한다.
   * 한 쪽씩만 있으면 아직 상대가 등록하지 않았거나 이름이 다르게 적힌 것이다.
   */
  const pairNameGroups = (() => {
    const key = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
    const groups = new Map<
      string,
      { label: string; hunters: PublicProfile[]; constellations: PublicProfile[] }
    >();

    for (const profile of profiles) {
      const written = (profile.pairName ?? '').trim();
      if (!written) continue;
      // 이미 편성된 사람은 묶을 필요가 없다
      if (activeBonds.some(
        (bond) =>
          bond.hunterAccountId === profile.accountId ||
          bond.constellationAccountId === profile.accountId,
      )) {
        continue;
      }

      const id = key(written);
      const group = groups.get(id) ?? { label: written, hunters: [], constellations: [] };
      if (profile.side === 'HUNTER') group.hunters.push(profile);
      else group.constellations.push(profile);
      groups.set(id, group);
    }

    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  })();

  return (
      <>
        {pairNameGroups.length > 0 && (
          <section className="panel">
            <div className="process-head">
              <h2 className="panel-title">페어명 묶음 · {pairNameGroups.length}</h2>
              <span className="hint">
                참가자가 시트에 적어 낸 페어명으로 묶었습니다. 띄어쓰기 · 대소문자는 무시합니다.
              </span>
            </div>
            <ul className="pair-group-list">
              {pairNameGroups.map((group) => {
                const ready = group.hunters.length === 1 && group.constellations.length === 1;
                const member = (row: PublicProfile) => (
                  <span key={row.accountId} className="pair-group-member">
                    <span className={`tag ${row.side === 'HUNTER' ? 'blue' : 'gold'}`}>
                      {row.side === 'HUNTER' ? '헌터' : '성좌'}
                    </span>
                    {row.name}
                    <small className="dim">@{row.accountId}</small>
                  </span>
                );

                return (
                  <li key={group.label} className={ready ? 'ready' : ''}>
                    <b className="pair-group-name">{group.label}</b>
                    <div className="pair-group-members">
                      {group.hunters.map(member)}
                      {group.constellations.map(member)}
                    </div>
                    {ready ? (
                      <button
                        type="button"
                        className="ctl primary small"
                        disabled={busy}
                        onClick={() =>
                          void createBond(
                            group.hunters[0].accountId,
                            group.constellations[0].accountId,
                          )
                        }
                      >
                        이 이름으로 계약 성립
                      </button>
                    ) : (
                      <span className="tag warn">
                        {group.hunters.length === 0
                          ? '헌터 없음'
                          : group.constellations.length === 0
                            ? '성좌 없음'
                            : '한 조에 3명 이상 — 직접 고르세요'}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="panel">
          <div className="process-head">
            <h2 className="panel-title">새 편성</h2>
            <span className="hint">
              페어는 한 번 맺으면 공략 내내 유지됩니다. 전투마다 다시 짝을 짓지 않습니다.
            </span>
          </div>
          <div className="pairing-row">
            <label className="num-field">
              <span className="field-label">헌터</span>
              <select
                className="ctl input"
                value={pairingHunter}
                onChange={(event) => setPairingHunter(event.target.value)}
              >
                <option value="">선택…</option>
                {profiles
                  .filter((row) => row.side === 'HUNTER')
                  .map((row) => {
                    const bonded = activeBonds.some((b) => b.hunterAccountId === row.accountId);
                    return (
                      <option key={row.accountId} value={row.accountId} disabled={bonded}>
                        {row.name} · {row.accountId}
                        {row.pairName ? ` — ${row.pairName}` : ''}
                        {bonded ? ' (편성됨)' : ''}
                      </option>
                    );
                  })}
              </select>
            </label>
            <span className="pairing-x">×</span>
            <label className="num-field">
              <span className="field-label">성좌</span>
              <select
                className="ctl input"
                value={pairingConstellation}
                onChange={(event) => setPairingConstellation(event.target.value)}
              >
                <option value="">선택…</option>
                {profiles
                  .filter((row) => row.side === 'CONSTELLATION')
                  .map((row) => {
                    const bonded = activeBonds.some(
                      (b) => b.constellationAccountId === row.accountId,
                    );
                    return (
                      <option key={row.accountId} value={row.accountId} disabled={bonded}>
                        {row.name} · {row.accountId}
                        {row.pairName ? ` — ${row.pairName}` : ''}
                        {bonded ? ' (편성됨)' : ''}
                      </option>
                    );
                  })}
              </select>
            </label>
            <button
              type="button"
              className="ctl primary"
              disabled={busy || !pairingHunter || !pairingConstellation}
              onClick={() => void createBond()}
            >
              {busy ? '처리 중…' : '계약 성립'}
            </button>
          </div>
          {unpaired.length > 0 && (
            <p className="hint">
              미편성 참가자 {unpaired.length}명 —{' '}
              {unpaired.map((row) => `${row.name}(${row.side === 'HUNTER' ? '헌터' : '성좌'})`).join(', ')}
            </p>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title">편성 명부</h2>
          {activeBonds.length === 0 ? (
            <p className="dim">편성된 페어가 없습니다.</p>
          ) : (
            <div className="bond-list">
              {activeBonds.map((bond) => (
                <article className="bond-card" key={bond.id}>
                  <div className="bond-head">
                    {/* 글자마다 저장하지 않는다 — 칸을 벗어날 때 한 번만 반영한다 */}
                    <input
                      key={`${bond.id}-${bond.label}`}
                      className="ctl input bond-name"
                      defaultValue={bond.label}
                      title="페어명 — 참가자가 적어 낸 이름으로 고칠 수 있습니다"
                      onBlur={(event) => {
                        const next = event.target.value.trim();
                        if (next && next !== bond.label) void patchBond(bond, { label: next });
                      }}
                    />
                    <span className={`tag ${bond.affiliation === 'GOVERNMENT' ? 'blue' : 'gold'}`}>
                      {bond.affiliation === 'GOVERNMENT' ? 'GOVERNMENT' : 'PRIVATE GUILD'}
                    </span>
                  </div>
                  <div className="bond-body">
                    <div>
                      <span className="field-label">HUNTER</span>
                      <b>{bond.hunterName}</b>
                      <small className="dim">{bond.hunterAccountId}</small>
                    </div>
                    <span className="bond-link" aria-hidden="true">
                      ✦
                    </span>
                    <div>
                      <span className="field-label">CONSTELLATION</span>
                      <b>{bond.constellationName}</b>
                      <small className="dim">{bond.constellationAccountId}</small>
                    </div>
                  </div>
                  {/* 소지금과 가방은 개인 것이다 — 창구도 사람마다 연다 */}
                  {(
                    [
                      ['HUNTER', bond.hunterAccountId],
                      ['CONSTELLATION', bond.constellationAccountId],
                    ] as Array<[ActorSide, string | null]>
                  ).map(([side, accountId]) => {
                    const owner = accountId
                      ? sheets.find((row) => row.accountId === accountId)
                      : undefined;
                    if (!owner) return null;

                    return (
                      <Collapsible
                        key={`shop-${side}`}
                        label={`보급 창구 · ${owner.sheet.name} — ${owner.sheet.points ?? 0} P`}
                      >
                        <div className="bond-resource">
                          <span className="field-label">소지금</span>
                          <b className="num gold">{owner.sheet.points ?? 0} P</b>
                          <NumberField
                            label="포인트 조정"
                            value={owner.sheet.points ?? 0}
                            step={10}
                            onCommit={(value) =>
                              void saveSheet(owner.accountId, {
                                ...owner.sheet,
                                points: Math.max(0, value),
                              })
                            }
                          />
                        </div>
                        <p className="hint">
                          전투 중에는 포인트로 아무것도 살 수 없습니다. 보급은 전투 밖에서만
                          처리합니다.
                        </p>
                        <ul className="shop-list">
                          {shopRows().map((row) => {
                            const owned =
                              (owner.sheet.inventory ?? []).find(
                                (stack) => stack.itemId === row.itemId,
                              )?.quantity ?? 0;
                            const full = row.limit !== null && owned >= row.limit;
                            return (
                              <li key={row.itemId}>
                                <span className="shop-name">
                                  {row.item.nameKo}
                                  <small className="dim">
                                    {describeItem(row.item).join(' / ') || '효과 없음'}
                                  </small>
                                </span>
                                <b className="num gold">{row.price} P</b>
                                <span className="tag">
                                  보유 {owned}
                                  {row.limit !== null ? ` / ${row.limit}` : ''}
                                </span>
                                <button
                                  type="button"
                                  className="ctl small"
                                  disabled={busy || full || (owner.sheet.points ?? 0) < row.price}
                                  onClick={() => void buyForSheet(owner, row.itemId)}
                                >
                                  구매
                                </button>
                                <button
                                  type="button"
                                  className="ctl small"
                                  disabled={busy || owned <= 0}
                                  title={`반납하면 ${Math.floor(row.price * REFUND_RATIO)} P 를 돌려줍니다`}
                                  onClick={() => void sellForSheet(owner, row.itemId)}
                                >
                                  반납 +{Math.floor(row.price * REFUND_RATIO)} P
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </Collapsible>
                    );
                  })}

                  <Collapsible label="시트 열람 — 스탯 · 스킬 · 컨셉">
                    <div className="sheet-list">
                      {(
                        [
                          ['HUNTER', bond.hunterAccountId],
                          ['CONSTELLATION', bond.constellationAccountId],
                        ] as Array<[ActorSide, string | null]>
                      ).map(([side, accountId]) => {
                        const sheet = sheetOf(accountId);
                        if (!sheet) {
                          return (
                            <p className="dim small-text" key={side}>
                              {sideLabel(side)} 시트를 불러올 수 없습니다
                              {accountId ? ` (${accountId})` : ' — 계정 미지정'}.
                            </p>
                          );
                        }
                        return (
                          <SheetDetail
                            key={side}
                            sheet={sheet}
                            accountId={accountId ?? undefined}
                            supply={{
                              points: sheet.points ?? 0,
                              inventory: sheet.inventory ?? [],
                            }}
                          />
                        );
                      })}
                    </div>
                  </Collapsible>

                  <div className="bond-foot">
                    <TextField
                      label="표기명"
                      value={bond.label}
                      onCommit={(value) => void patchBond(bond, { label: value })}
                    />
                    <label className="num-field">
                      <span className="field-label">소속</span>
                      <select
                        className="ctl input"
                        value={bond.affiliation}
                        onChange={(event) =>
                          void patchBond(bond, {
                            affiliation: event.target.value as PairBond['affiliation'],
                          })
                        }
                      >
                        <option value="GOVERNMENT">GOVERNMENT · 정부</option>
                        <option value="PRIVATE_GUILD">PRIVATE GUILD · 민간 길드</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="ctl small"
                      disabled={busy}
                      onClick={() => {
                        if (confirmed(`${bond.label} 을 해산합니다. 기록은 남고 편성에서만 빠집니다.`)) {
                          void patchBond(bond, { active: false });
                        }
                      }}
                      title="기록은 남고 편성에서만 제외됩니다"
                    >
                      해산
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {bonds.some((row) => !row.active) && (
            <Collapsible label={`해산된 페어 ${bonds.filter((r) => !r.active).length}`}>
              <div className="bond-list">
                {bonds
                  .filter((row) => !row.active)
                  .map((bond) => (
                    <article className="bond-card dim-card" key={bond.id}>
                      <div className="bond-head">
                        <b>{bond.label}</b>
                        <span className="tag offline">해산</span>
                      </div>
                      <p className="dim">
                        {bond.hunterName} × {bond.constellationName}
                      </p>
                      <div className="btn-row">
                        <button
                          type="button"
                          className="ctl small"
                          onClick={() => void patchBond(bond, { active: true })}
                        >
                          복원
                        </button>
                        <button
                          type="button"
                          className="ctl small"
                          onClick={() => {
                            if (!confirmed(`${bond.label} 기록을 영구 삭제합니다. 되돌릴 수 없습니다.`)) return;
                            void guard(async () => {
                              await storage.deleteBond(bond.id);
                              await refresh();
                            });
                          }}
                        >
                          영구 삭제
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
            </Collapsible>
          )}
        </section>
      </>
  );
}
