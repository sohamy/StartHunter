/**
 * 상점 진열 편집 — 운영진 전용.
 *
 * 기본 품목(config/items.ts · config/shop.ts)은 코드에 남는다.
 * 이 화면은 그 위에 얹는 층이다.
 *   · 기본 품목의 가격 · 한도를 고치거나 진열에서 뺀다
 *   · 없던 품목을 새로 만들어 붙인다 — 정의까지 여기서 적는다
 *
 * 새로 만든 품목도 전투에서 그대로 쓰인다. 엔진은 아이템을 이름으로 알지 않고
 * effect 필드만 해석하므로, 여기서 넣은 값이 곧 판정에 들어간다.
 */

import { useState } from 'react';

import {
  ITEM_CATEGORY_LABELS,
  ITEM_DEFINITIONS,
  describeItem,
  findItem,
} from '../config/items';
import { SHOP_ENTRIES } from '../config/shop';
import { REFUND_RATIO } from '../engine/shop';
import { STATUS_DEFINITIONS } from '../config/status';
import type {
  Affiliation,
  ItemCategory,
  ItemDefinition,
  ShopItemRecord,
  StatusKind,
  TargetType,
} from '../types';

const CATEGORY_KEYS = Object.keys(ITEM_CATEGORY_LABELS) as ItemCategory[];
const TARGETS: Array<{ value: TargetType; label: string }> = [
  { value: 'SELF', label: '자신' },
  { value: 'ALLY', label: '아군' },
  { value: 'PAIR', label: '페어' },
  { value: 'ENEMY', label: '적' },
];
const CURE_KINDS: StatusKind[] = ['DOT', 'DEBUFF', 'BUFF', 'CONTROL'];

/** 효과 칸 — 0 이면 저장할 때 떨어져 나간다 */
const EFFECT_FIELDS: Array<{ key: keyof ItemDefinition['effect']; label: string; step: number }> = [
  { key: 'healHp', label: 'HP 회복(고정)', step: 5 },
  { key: 'healPercent', label: 'HP 회복(비율 0~1)', step: 0.05 },
  { key: 'revivePercent', label: '부활 HP 비율', step: 0.05 },
  { key: 'restoreAp', label: '행동력 회복', step: 1 },
  { key: 'damage', label: '적 피해', step: 5 },
  { key: 'contractRepair', label: '계약 안정도 회복', step: 1 },
  { key: 'stageRepair', label: '성좌 단계 회복', step: 1 },
];

/** 새 품목의 빈 정의 */
function blankItem(): ItemDefinition {
  return {
    id: `item.custom.${Date.now().toString(36)}`,
    name: '',
    nameKo: '',
    category: 'SHARED',
    description: '',
    target: 'ALLY',
    apCost: 1,
    combatUsable: true,
    effect: {},
  };
}

function blankRecord(sort: number): ShopItemRecord {
  return { itemId: blankItem().id, price: 100, limit: 3, active: true, sort, item: blankItem() };
}

/** 기본 품목을 진열에 얹기 위한 첫 값 — 코드에 적힌 가격에서 출발한다 */
function overrideFor(itemId: string, sort: number): ShopItemRecord {
  const base = SHOP_ENTRIES.find((row) => row.itemId === itemId);
  return {
    itemId,
    price: base?.price ?? 100,
    limit: base?.limit ?? null,
    active: true,
    sort,
    item: null,
  };
}

export default function ShopEditor({
  records,
  busy,
  onSave,
  onDelete,
}: {
  records: ShopItemRecord[];
  busy?: boolean;
  onSave: (record: ShopItemRecord) => void;
  onDelete: (itemId: string) => void;
}) {
  const [draft, setDraft] = useState<ShopItemRecord | null>(null);
  const [pick, setPick] = useState('');

  const edited = new Set(records.map((row) => row.itemId));
  /** 아직 손대지 않은 기본 품목 — 여기서 골라 진열에 얹는다 */
  const untouched = SHOP_ENTRIES.filter((row) => !edited.has(row.itemId));
  const nextSort = records.length > 0 ? Math.max(...records.map((row) => row.sort)) + 1 : 0;

  const patch = (next: Partial<ShopItemRecord>) =>
    setDraft((current) => (current ? { ...current, ...next } : current));

  const patchItem = (next: Partial<ItemDefinition>) =>
    setDraft((current) =>
      current && current.item ? { ...current, item: { ...current.item, ...next } } : current,
    );

  const patchEffect = (key: keyof ItemDefinition['effect'], value: number | undefined) =>
    setDraft((current) => {
      if (!current?.item) return current;
      const effect = { ...current.item.effect };
      if (value === undefined || value === 0 || Number.isNaN(value)) delete effect[key];
      else (effect[key] as number) = value;
      return { ...current, item: { ...current.item, effect } };
    });

  const toggleStatus = (defId: string) =>
    setDraft((current) => {
      if (!current?.item) return current;
      const list = current.item.effect.applyStatusIds ?? [];
      const next = list.includes(defId)
        ? list.filter((id) => id !== defId)
        : [...list, defId];
      return {
        ...current,
        item: {
          ...current.item,
          effect: { ...current.item.effect, applyStatusIds: next.length ? next : undefined },
        },
      };
    });

  const toggleCure = (kind: StatusKind) =>
    setDraft((current) => {
      if (!current?.item) return current;
      const list = current.item.effect.cureKinds ?? [];
      const next = list.includes(kind) ? list.filter((row) => row !== kind) : [...list, kind];
      return {
        ...current,
        item: {
          ...current.item,
          effect: { ...current.item.effect, cureKinds: next.length ? next : undefined },
        },
      };
    });

  const commit = () => {
    if (!draft) return;
    // 새 품목은 정의의 id 를 진열 id 로 삼는다 — 두 값이 갈라지지 않게 한다
    const record = draft.item ? { ...draft, itemId: draft.item.id } : draft;
    onSave(record);
    setDraft(null);
  };

  return (
    <div className="shop-editor">
      <div className="btn-row">
        <button
          type="button"
          className="ctl"
          disabled={busy}
          onClick={() => setDraft(blankRecord(nextSort))}
        >
          + 새 품목 만들기
        </button>

        {untouched.length > 0 && (
          <>
            <select className="ctl" value={pick} onChange={(event) => setPick(event.target.value)}>
              <option value="">기본 품목 골라 얹기…</option>
              {untouched.map((row) => (
                <option key={row.itemId} value={row.itemId}>
                  {findItem(row.itemId)?.nameKo ?? row.itemId} · {row.price}P
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ctl"
              disabled={busy || !pick}
              onClick={() => {
                setDraft(overrideFor(pick, nextSort));
                setPick('');
              }}
            >
              가격 · 한도 고치기
            </button>
          </>
        )}
      </div>

      <p className="hint">
        여기 없는 품목은 코드에 적힌 기본값으로 진열됩니다. 가격을 고치거나 진열에서 빼려면
        위에서 골라 얹으세요.
      </p>

      {records.length > 0 && (
        <ul className="shop-list" style={{ marginTop: 12 }}>
          {records.map((row) => {
            const item = row.item ?? findItem(row.itemId);
            return (
              <li key={row.itemId}>
                <span className="shop-name">
                  {item?.nameKo || row.itemId}
                  <small className="dim">
                    {row.item ? '운영진 추가 품목' : '기본 품목 · 값 덮어씀'}
                    {item ? ` — ${describeItem(item).join(' / ') || '효과 없음'}` : ''}
                  </small>
                </span>
                <b className="num gold">{row.price} P</b>
                <span className="tag">반납 +{Math.floor(row.price * REFUND_RATIO)} P</span>
                <span className="tag">한도 {row.limit === null ? '없음' : row.limit}</span>
                <span className={`tag ${row.active ? 'ok' : 'offline'}`}>
                  {row.active ? '진열 중' : '숨김'}
                </span>
                <button
                  type="button"
                  className="ctl small"
                  disabled={busy}
                  onClick={() => setDraft(row)}
                >
                  수정
                </button>
                <button
                  type="button"
                  className="ctl small"
                  disabled={busy}
                  title="진열에서 지웁니다 — 기본 품목이면 코드의 기본값으로 돌아갑니다"
                  onClick={() => onDelete(row.itemId)}
                >
                  삭제
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {draft && (
        <article className="shop-form">
          <header className="sheet-card-head">
            <b>{draft.item ? '품목 만들기 · 수정' : '기본 품목 값 고치기'}</b>
            <span className="field-label">{draft.item?.id ?? draft.itemId}</span>
          </header>

          <div className="admin-grid">
            <label className="input-row">
              <span className="field-label">
                가격 (P)
                <small className="dim"> 반납 +{Math.floor(draft.price * REFUND_RATIO)} P</small>
              </span>
              <input
                className="ctl input"
                type="number"
                min={0}
                value={draft.price}
                onChange={(event) => patch({ price: Number(event.target.value) })}
              />
            </label>
            <label className="input-row">
              <span className="field-label">보유 한도 (비우면 제한 없음)</span>
              <input
                className="ctl input"
                type="number"
                min={0}
                value={draft.limit ?? ''}
                onChange={(event) =>
                  patch({ limit: event.target.value === '' ? null : Number(event.target.value) })
                }
              />
            </label>
            <label className="input-row">
              <span className="field-label">진열 순서</span>
              <input
                className="ctl input"
                type="number"
                value={draft.sort}
                onChange={(event) => patch({ sort: Number(event.target.value) })}
              />
            </label>
            <div className="input-row">
              <span className="field-label">진열</span>
              <button
                type="button"
                className={`ctl ${draft.active ? 'on' : ''}`}
                onClick={() => patch({ active: !draft.active })}
              >
                {draft.active ? '진열 중 — 참가자에게 보입니다' : '숨김 — 목록에서 뺍니다'}
              </button>
            </div>
          </div>

          {draft.item && (
            <>
              <h3 className="sub-title">품목 정의</h3>
              <div className="admin-grid">
                <label className="input-row">
                  <span className="field-label">이름 (한글)</span>
                  <input
                    className="ctl input"
                    value={draft.item.nameKo}
                    placeholder="예: 별빛 응고제"
                    onChange={(event) => patchItem({ nameKo: event.target.value })}
                  />
                </label>
                <label className="input-row">
                  <span className="field-label">이름 (표기)</span>
                  <input
                    className="ctl input"
                    value={draft.item.name}
                    placeholder="예: STARLIGHT COAGULANT"
                    onChange={(event) => patchItem({ name: event.target.value })}
                  />
                </label>
                <label className="input-row">
                  <span className="field-label">분류</span>
                  <select
                    className="ctl"
                    value={draft.item.category}
                    onChange={(event) =>
                      patchItem({ category: event.target.value as ItemCategory })
                    }
                  >
                    {CATEGORY_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {ITEM_CATEGORY_LABELS[key].labelKo}
                      </option>
                    ))}
                  </select>
                </label>
                {draft.item.category === 'AFFILIATION' && (
                  <label className="input-row">
                    <span className="field-label">진영</span>
                    <select
                      className="ctl"
                      value={draft.item.affiliation ?? 'GOVERNMENT'}
                      onChange={(event) =>
                        patchItem({ affiliation: event.target.value as Affiliation })
                      }
                    >
                      <option value="GOVERNMENT">정부</option>
                      <option value="PRIVATE_GUILD">민간 길드</option>
                    </select>
                  </label>
                )}
                <label className="input-row">
                  <span className="field-label">대상</span>
                  <select
                    className="ctl"
                    value={draft.item.target}
                    onChange={(event) => patchItem({ target: event.target.value as TargetType })}
                  >
                    {TARGETS.map((row) => (
                      <option key={row.value} value={row.value}>
                        {row.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="input-row">
                  <span className="field-label">행동력 비용</span>
                  <input
                    className="ctl input"
                    type="number"
                    min={0}
                    value={draft.item.apCost}
                    onChange={(event) => patchItem({ apCost: Number(event.target.value) })}
                  />
                </label>
                <div className="input-row">
                  <span className="field-label">전투 중 사용</span>
                  <button
                    type="button"
                    className={`ctl ${draft.item.combatUsable ? 'on' : ''}`}
                    onClick={() => patchItem({ combatUsable: !draft.item?.combatUsable })}
                  >
                    {draft.item.combatUsable ? '가능' : '불가'}
                  </button>
                </div>
              </div>

              <label className="input-row">
                <span className="field-label">설명</span>
                <textarea
                  className="ctl input textarea"
                  rows={2}
                  value={draft.item.description}
                  placeholder="무엇을 하는 물건인지 한 줄로"
                  onChange={(event) => patchItem({ description: event.target.value })}
                />
              </label>

              <h3 className="sub-title">효과 — 비워 두면 그 효과는 없습니다</h3>
              <div className="admin-grid">
                {EFFECT_FIELDS.map((field) => (
                  <label className="input-row" key={field.key}>
                    <span className="field-label">{field.label}</span>
                    <input
                      className="ctl input"
                      type="number"
                      step={field.step}
                      min={0}
                      value={(draft.item?.effect[field.key] as number | undefined) ?? ''}
                      onChange={(event) =>
                        patchEffect(
                          field.key,
                          event.target.value === '' ? undefined : Number(event.target.value),
                        )
                      }
                    />
                  </label>
                ))}
              </div>

              <div className="input-row">
                <span className="field-label">부여 상태이상</span>
                <div className="chip-row">
                  {STATUS_DEFINITIONS.map((def) => (
                    <button
                      key={def.id}
                      type="button"
                      className={`chip-btn ${
                        draft.item?.effect.applyStatusIds?.includes(def.id) ? 'on' : ''
                      }`}
                      title={`${def.description} · ${def.duration}R`}
                      onClick={() => toggleStatus(def.id)}
                    >
                      {def.label}
                      <small>{def.labelKo}</small>
                    </button>
                  ))}
                </div>
              </div>

              <div className="input-row">
                <span className="field-label">해제하는 상태이상</span>
                <div className="chip-row">
                  {CURE_KINDS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className={`chip-btn ${
                        draft.item?.effect.cureKinds?.includes(kind) ? 'on' : ''
                      }`}
                      onClick={() => toggleCure(kind)}
                    >
                      {kind}
                    </button>
                  ))}
                </div>
              </div>

              <p className="hint">
                미리보기 — {describeItem(draft.item).join(' / ') || '효과 없음'}
              </p>
            </>
          )}

          <div className="btn-row">
            <button
              type="button"
              className="ctl primary"
              disabled={busy || (draft.item !== null && draft.item.nameKo.trim().length === 0)}
              onClick={commit}
            >
              {busy ? '저장 중…' : '저장'}
            </button>
            <button type="button" className="ctl" onClick={() => setDraft(null)}>
              닫기
            </button>
            {draft.item !== null && draft.item.nameKo.trim().length === 0 && (
              <span className="hint">이름(한글)을 적어야 저장할 수 있습니다.</span>
            )}
          </div>
        </article>
      )}

      <p className="hint" style={{ marginTop: 12 }}>
        코드에 있는 기본 품목 {ITEM_DEFINITIONS.length}종 · 진열 규칙 {SHOP_ENTRIES.length}줄 위에
        이 목록이 얹힙니다.
      </p>
    </div>
  );
}
