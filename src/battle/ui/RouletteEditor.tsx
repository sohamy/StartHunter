/**
 * 룰렛 원반 편집 — 운영진 전용.
 *
 * 상점(ShopEditor)과 달리 코드에 기본 목록이 없다. 여기서 만든 것이 전부다 —
 * 칸도 확률도 참가비도 회차마다 달라지는 값이라, 코드에 심어 두면 고칠 때마다 배포해야 한다.
 *
 * 확률은 **무게**로 적는다. 옆에 실제 % 를 계속 보여 주므로,
 * 칸을 더하거나 빼도 지금 몇 %인지 눈으로 확인하면서 맞출 수 있다.
 *
 * 한 번 돌릴 때의 평균 손익(기대값)을 항상 띄운다 —
 * 이 값이 0 을 넘으면 참가자가 돌릴수록 소지금이 불어나므로, 그때는 경고한다.
 */

import { useState } from 'react';

import { chanceText, expectedNet, expectedPayout, topPayout, totalWeight, wheelProblem } from '../engine/roulette';
import type { RouletteSlot, RouletteWheel } from '../types';

/** 새 원반의 첫 모습 — 바로 돌려 볼 수 있는 값으로 채운다 */
function blankWheel(sort: number): RouletteWheel {
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `wheel-${Date.now().toString(36)}`,
    name: '',
    description: '',
    entryFee: 50,
    slots: [
      { label: '꽝', payout: 0, weight: 50 },
      { label: '30 P', payout: 30, weight: 30 },
      { label: '100 P', payout: 100, weight: 15 },
      { label: '400 P', payout: 400, weight: 5 },
    ],
    active: true,
    sort,
  };
}

export default function RouletteEditor({
  wheels,
  busy,
  onSave,
  onDelete,
}: {
  wheels: RouletteWheel[];
  busy?: boolean;
  onSave: (wheel: RouletteWheel) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState<RouletteWheel | null>(null);

  const nextSort = wheels.length > 0 ? Math.max(...wheels.map((row) => row.sort)) + 1 : 0;

  const patch = (next: Partial<RouletteWheel>) =>
    setDraft((current) => (current ? { ...current, ...next } : current));

  const patchSlot = (index: number, next: Partial<RouletteSlot>) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            slots: current.slots.map((slot, row) => (row === index ? { ...slot, ...next } : slot)),
          }
        : current,
    );

  const addSlot = () =>
    setDraft((current) =>
      current
        ? { ...current, slots: [...current.slots, { label: '', payout: 0, weight: 10 }] }
        : current,
    );

  const dropSlot = (index: number) =>
    setDraft((current) =>
      current ? { ...current, slots: current.slots.filter((_, row) => row !== index) } : current,
    );

  const problem = draft ? wheelProblem(draft) : null;
  const houseEdge = draft ? expectedNet(draft) : 0;

  return (
    <div className="wheel-editor">
      {/* ── 지금 열려 있는 원반들 ── */}
      {wheels.length === 0 ? (
        <p className="dim">아직 만든 원반이 없습니다. 아래에서 하나 만드세요.</p>
      ) : (
        <ul className="wheel-admin-list">
          {wheels.map((row) => {
            const net = expectedNet(row);
            return (
              <li key={row.id} className={row.active ? '' : 'off'}>
                <div className="wheel-admin-head">
                  <b>{row.name || '(이름 없음)'}</b>
                  <span className={`tag ${row.active ? 'ok' : ''}`}>
                    {row.active ? '열림' : '닫힘'}
                  </span>
                  <span className="num">참가비 {row.entryFee} P</span>
                  <span className="num dim">칸 {row.slots.length}</span>
                  <span className={`num ${net >= 0 ? 'danger-text' : 'dim'}`}>
                    평균 {net >= 0 ? '+' : ''}
                    {net.toFixed(1)} P
                  </span>
                  <span className="num dim">최고 {topPayout(row.slots)} P</span>
                </div>
                <div className="btn-row">
                  <button
                    type="button"
                    className="ctl small"
                    disabled={busy}
                    onClick={() => setDraft({ ...row, slots: row.slots.map((slot) => ({ ...slot })) })}
                  >
                    고치기
                  </button>
                  <button
                    type="button"
                    className="ctl small"
                    disabled={busy}
                    onClick={() => onSave({ ...row, active: !row.active })}
                  >
                    {row.active ? '닫기' : '열기'}
                  </button>
                  <button
                    type="button"
                    className="ctl small danger"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`'${row.name}' 원반을 지웁니다. 되돌릴 수 없습니다.`)) {
                        onDelete(row.id);
                        if (draft?.id === row.id) setDraft(null);
                      }
                    }}
                  >
                    삭제
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!draft && (
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="ctl primary"
            disabled={busy}
            onClick={() => setDraft(blankWheel(nextSort))}
          >
            원반 만들기
          </button>
        </div>
      )}

      {/* ── 편집 ── */}
      {draft && (
        <div className="wheel-draft">
          <div className="process-head">
            <h3 className="panel-title">{wheels.some((row) => row.id === draft.id) ? '원반 고치기' : '새 원반'}</h3>
            <span className="dim num">순서 {draft.sort}</span>
          </div>

          <div className="admin-grid">
            <label className="input-row">
              <span className="field-label">원반 이름</span>
              <input
                className="ctl input"
                value={draft.name}
                placeholder="예: 별자리 회전반"
                onChange={(event) => patch({ name: event.target.value })}
              />
            </label>

            <label className="input-row">
              <span className="field-label">참가비 (P)</span>
              <input
                className="ctl input"
                type="number"
                min={0}
                step={10}
                value={draft.entryFee}
                onChange={(event) =>
                  patch({ entryFee: Math.max(0, Math.floor(Number(event.target.value) || 0)) })
                }
              />
            </label>

            <label className="input-row">
              <span className="field-label">진열 순서</span>
              <input
                className="ctl input"
                type="number"
                value={draft.sort}
                onChange={(event) => patch({ sort: Math.floor(Number(event.target.value) || 0) })}
              />
            </label>

            <label className="input-row">
              <span className="field-label">지금 열어 둘지</span>
              <select
                className="ctl input"
                value={draft.active ? 'ON' : 'OFF'}
                onChange={(event) => patch({ active: event.target.value === 'ON' })}
              >
                <option value="ON">열림 — 참가자에게 보인다</option>
                <option value="OFF">닫힘 — 목록에서 뺀다</option>
              </select>
            </label>
          </div>

          <label className="input-row" style={{ marginTop: 10 }}>
            <span className="field-label">설명 (도박장 화면에 뜬다)</span>
            <input
              className="ctl input"
              value={draft.description}
              placeholder="예: 관리국이 눈감아 주는 뒷골목 원반."
              onChange={(event) => patch({ description: event.target.value })}
            />
          </label>

          {/* ── 칸 ── */}
          <div className="process-head" style={{ marginTop: 16 }}>
            <h3 className="panel-title">칸 · {draft.slots.length}</h3>
            <span className="dim">무게 합 {totalWeight(draft.slots)}</span>
          </div>
          <p className="hint" style={{ marginBottom: 10 }}>
            확률은 <b>무게</b>로 적습니다 — 옆의 %는 전체 무게로 나눈 실제 확률입니다. 칸을 더하고
            빼도 나머지 칸끼리의 비율은 그대로 유지됩니다. 무게가 0 인 칸은 원반에 보이지만
            걸리지 않습니다.
          </p>

          <ul className="slot-editor">
            {draft.slots.map((slot, index) => (
              <li key={index}>
                <input
                  className="ctl input"
                  value={slot.label}
                  placeholder="칸 이름 (예: 꽝 · 120 P)"
                  onChange={(event) => patchSlot(index, { label: event.target.value })}
                />
                <label className="slot-field">
                  <span className="field-label">받는 값 P</span>
                  <input
                    className="ctl input"
                    type="number"
                    min={0}
                    step={10}
                    value={slot.payout}
                    onChange={(event) =>
                      patchSlot(index, {
                        payout: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                      })
                    }
                  />
                </label>
                <label className="slot-field">
                  <span className="field-label">무게</span>
                  <input
                    className="ctl input"
                    type="number"
                    min={0}
                    step={1}
                    value={slot.weight}
                    onChange={(event) =>
                      patchSlot(index, {
                        weight: Math.max(0, Number(event.target.value) || 0),
                      })
                    }
                  />
                </label>
                <span className="num slot-chance">{chanceText(draft.slots, index)}</span>
                <button
                  type="button"
                  className="ctl small danger"
                  onClick={() => dropSlot(index)}
                  title="이 칸을 지웁니다"
                >
                  −
                </button>
              </li>
            ))}
          </ul>

          <div className="btn-row" style={{ marginTop: 8 }}>
            <button type="button" className="ctl small" onClick={addSlot}>
              칸 추가
            </button>
          </div>

          {/* ── 손익 미리보기 ── */}
          <div className="wheel-ledger">
            <div>
              <span className="field-label">한 번 돌릴 때 평균 지급</span>
              <b className="num">{expectedPayout(draft.slots).toFixed(1)} P</b>
            </div>
            <div>
              <span className="field-label">참가비</span>
              <b className="num">−{draft.entryFee} P</b>
            </div>
            <div>
              <span className="field-label">참가자 평균 손익</span>
              <b className={`num ${houseEdge >= 0 ? 'danger-text' : 'gold'}`}>
                {houseEdge >= 0 ? '+' : ''}
                {houseEdge.toFixed(1)} P
              </b>
            </div>
          </div>

          {houseEdge >= 0 && (
            <p className="notice warn" style={{ marginTop: 10 }}>
              <b>참가자 평균 손익이 0 이상입니다.</b> 이대로 열면 계속 돌리는 것만으로 소지금이
              불어납니다. 참가비를 올리거나 큰 칸의 무게를 줄이세요.
            </p>
          )}
          {problem && (
            <p className="notice warn" style={{ marginTop: 10 }}>
              {problem}
            </p>
          )}

          <div className="btn-row" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="ctl primary"
              disabled={busy || problem !== null}
              onClick={() => {
                onSave(draft);
                setDraft(null);
              }}
            >
              저장
            </button>
            <button type="button" className="ctl" disabled={busy} onClick={() => setDraft(null)}>
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
