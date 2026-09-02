/**
 * 작전실 공용 부품.
 *
 * 탭마다 따로 두면 같은 입력칸이 화면마다 조금씩 달라진다 —
 * 운영진이 쓰는 칸은 어느 탭에서 만나든 같은 물건이어야 한다.
 *
 * 여기 있는 것은 탭 하나에 속하지 않는 것들뿐이다.
 * 한 탭에서만 쓰는 부품은 그 탭 파일에 둔다.
 */

import { useEffect, useState } from 'react';

import { ITEM_DEFINITIONS, describeItem, findItem } from '../../config/items';
import { STATUS_DEFINITIONS } from '../../config/status';
import { newUuid } from '../../engine/id';
import { statusViews } from '../../engine/status';
import { pairReady } from '../../engine/battle';
import type { SheetRecord } from '../../store';
import type { ActorSide, BattleState, StatusEffect, StatusHolder } from '../../types';

/**
 * 참가자에게 남길 공개 시트 주소.
 *
 * 이 주소로 열리는 화면에는 공개분만 뜬다 — 스탯도 스킬 수치도 담기지 않는다.
 * 커뮤니티에 그대로 붙여 넣을 수 있도록 절대 주소로 만든다.
 */
export function publicSheetUrl(accountId: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const path = `${base}/battle/sheet/?id=${encodeURIComponent(accountId)}`;
  return typeof window === 'undefined' ? path : `${window.location.origin}${path}`;
}

/** 공개 전투 기록 주소 — 커뮤니티에 그대로 붙일 수 있게 절대 주소로 만든다 */
export function publicRecordUrl(recordId: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const path = `${base}/battle/record/?id=${encodeURIComponent(recordId)}`;
  return typeof window === 'undefined' ? path : `${window.location.origin}${path}`;
}

/**
 * 공개 주소 한 줄 — 눈으로 확인하고, 눌러서 복사하고, 열어 볼 수 있게 한다.
 *
 * 시트와 전투 기록이 같은 부품을 쓴다. 「주소를 남긴다」는 일은 어느 쪽이든 같은
 * 동작인데, 화면마다 다르게 생기면 어느 버튼이 복사인지 매번 다시 찾게 된다.
 */
export function ShareLink({ url, label = '공개 주소' }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // 클립보드가 막힌 환경에서는 주소를 직접 긁어 갈 수 있게 그대로 둔다
      setCopied(false);
    }
  };

  return (
    <div className="share-row">
      <span className="field-label">{label}</span>
      <input className="ctl input share-url" value={url} readOnly onFocus={(e) => e.target.select()} />
      <button type="button" className="ctl small" onClick={() => void copy()}>
        {copied ? '복사됨' : '주소 복사'}
      </button>
      <a className="ctl small" href={url} target="_blank" rel="noreferrer">
        열기
      </a>
    </div>
  );
}

export function PublicSheetLink({ accountId }: { accountId: string }) {
  return <ShareLink url={publicSheetUrl(accountId)} />;
}
/** 시트 전문(수치까지) 과 참가자에게 보이는 프로필 카드를 오간다 */
export type SheetLayout = 'DETAIL' | 'PROFILE';
export type LogTab = 'SYSTEM' | 'ROLEPLAY';

/**
 * 전투 편성 프리셋.
 *
 * 같은 페어 · 같은 적 조합을 매번 다시 고르는 일이 잦다.
 * 서버 스키마를 건드리지 않으려고 운영자 브라우저에만 남긴다.
 */
export interface OperationPreset {
  id: string;
  name: string;
  bondIds: string[];
  enemyIds: string[];
  gimmickId: string;
  floor: number;
}

const PRESET_KEY = 'tower-raid.operation-presets';

export function loadPresets(): OperationPreset[] {
  try {
    const raw = window.localStorage.getItem(PRESET_KEY);
    const rows: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(rows) ? (rows as OperationPreset[]) : [];
  } catch {
    return [];
  }
}

export function terminalUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/battle/`;
}

/** 되돌리기 어려운 조작은 한 번 되묻는다 */
export function confirmed(message: string): boolean {
  return typeof window === 'undefined' || window.confirm(message);
}

/** 목록에 쓰는 짧은 시각 표기 */
export function shortTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

/** 서버 기본키가 uuid 이므로 클라이언트도 uuid 를 만든다 */
export function newId(): string {
  return newUuid();
}

/* ── 공용 요소 ─────────────────────────────────────────── */

export function NumberField({
  label,
  value,
  onCommit,
  min = 0,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onCommit: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  /* 값은 blur 나 Enter 에서 반영된다 — 아직 안 들어갔음을 보여 준다 */
  const pending = draft !== String(value);

  return (
    <label className="num-field">
      <span className="field-label">
        {label}
        {pending && <i className="pending">ENTER</i>}
      </span>
      <input
        className={`ctl input ${pending ? 'pending' : ''}`}
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const parsed = Number(draft);
          if (!Number.isNaN(parsed) && parsed !== value) onCommit(parsed);
          else setDraft(String(value));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

export function TextField({
  label,
  value,
  onCommit,
  placeholder,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const pending = draft !== value;
  return (
    <label className="num-field">
      <span className="field-label">
        {label}
        {pending && <i className="pending">ENTER</i>}
      </span>
      <input
        className={`ctl input ${pending ? 'pending' : ''}`}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => draft !== value && onCommit(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

/**
 * 보급 조정 — 운영진이 한 사람에게 소지금과 보급품을 직접 준다.
 *
 * 상점을 거치지 않는다. 값을 받지 않고 그냥 주거나 거둬들이는 창구이므로,
 * 편성되지 않은 사람에게도 쓸 수 있다.
 */
export function SupplyAdmin({
  row,
  busy,
  onPoints,
  onItem,
}: {
  row: SheetRecord;
  busy: boolean;
  onPoints: (row: SheetRecord, delta: number, reason: string) => void;
  onItem: (row: SheetRecord, itemId: string, delta: number, reason: string) => void;
}) {
  const [amount, setAmount] = useState(100);
  /* 왜 고쳤는지 — 감사 기록에 함께 남는다. 분쟁이 나면 이 칸이 유일한 근거다 */
  const [reason, setReason] = useState('');
  const bag = (row.sheet.inventory ?? []).filter((stack) => stack.quantity > 0);

  return (
    <div className="item-admin">
      <label className="input-row">
        <span className="field-label">사유 (감사 기록에 남습니다)</span>
        <input
          className="ctl input"
          value={reason}
          placeholder="예: 3층 클리어 보상 · 오지급 회수"
          onChange={(event) => setReason(event.target.value)}
        />
      </label>

      <div className="bond-resource">
        <span className="field-label">소지금</span>
        <b className="num gold">{(row.sheet.points ?? 0).toLocaleString()} P</b>
        <input
          className="ctl input"
          type="number"
          min={0}
          step={10}
          value={amount}
          onChange={(event) => setAmount(Math.max(0, Number(event.target.value)))}
        />
        <button
          type="button"
          className="ctl small primary"
          disabled={busy || amount <= 0}
          onClick={() => onPoints(row, amount, reason)}
        >
          +{amount} P 지급
        </button>
        <button
          type="button"
          className="ctl small"
          disabled={busy || amount <= 0}
          onClick={() => onPoints(row, -amount, reason)}
        >
          −{amount} P 차감
        </button>
      </div>

      {bag.length > 0 && (
        <ul className="inventory-list">
          {bag.map((stack) => {
            const item = findItem(stack.itemId);
            if (!item) return null;
            return (
              <li key={stack.itemId}>
                <span>{item.nameKo}</span>
                <b className="num gold">{stack.quantity}</b>
                <button
                  type="button"
                  className="ctl small"
                  disabled={busy}
                  onClick={() => onItem(row, stack.itemId, 1, reason)}
                >
                  +1
                </button>
                <button
                  type="button"
                  className="ctl small"
                  disabled={busy}
                  onClick={() => onItem(row, stack.itemId, -1, reason)}
                >
                  −1
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <select
        className="ctl input"
        value=""
        disabled={busy}
        onChange={(event) => {
          if (!event.target.value) return;
          onItem(row, event.target.value, 1, reason);
        }}
      >
        <option value="">보급품 지급…</option>
        {ITEM_DEFINITIONS.map((item) => (
          <option key={item.id} value={item.id}>
            {item.nameKo} · {describeItem(item).join(' / ') || '효과 없음'}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Bar({ value, max, tone }: { value: number; max: number; tone: string }) {
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`gauge tone-${tone}`}>
      <div className="gauge-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

export function StatusEditor({
  holder,
  ownerId,
  statuses,
  onGrant,
  onRevoke,
}: {
  holder: StatusHolder;
  ownerId: string;
  statuses: StatusEffect[];
  onGrant: (holder: StatusHolder, ownerId: string, defId: string) => void;
  onRevoke: (holder: StatusHolder, ownerId: string, defId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const views = statusViews(statuses);

  return (
    <div className="status-editor">
      <div className="target-status">
        {views.length === 0 ? (
          <span className="dim">상태이상 없음</span>
        ) : (
          views.map((view) => (
            <button
              key={view.defId}
              type="button"
              className={`tag ${view.tone} removable`}
              title="클릭하면 제거"
              onClick={() => onRevoke(holder, ownerId, view.defId)}
            >
              {view.label}
              {view.stacks > 1 && <b> ×{view.stacks}</b>}
              <small> {view.remainingRounds}R ✕</small>
            </button>
          ))
        )}
        <button type="button" className="ctl small" onClick={() => setOpen(!open)}>
          {open ? '닫기' : '+ 부여'}
        </button>
      </div>
      {open && (
        <div className="status-picker">
          {STATUS_DEFINITIONS.map((def) => (
            <button
              key={def.id}
              type="button"
              className="chip-btn"
              title={`${def.description} · ${def.duration}R`}
              onClick={() => onGrant(holder, ownerId, def.id)}
            >
              {def.label}
              <small>{def.labelKo}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 프리셋을 브라우저에 적어 둔다. 저장에 실패하면 false 를 돌려준다 —
 * 무엇을 띄울지는 부르는 쪽이 정한다.
 */
export function writePresets(rows: OperationPreset[]): boolean {
  try {
    window.localStorage.setItem(PRESET_KEY, JSON.stringify(rows));
    return true;
  } catch {
    return false;
  }
}


/**
 * 전투 한 판의 집계.
 *
 * 상단 상황판과 전투 탭이 **같은 수**를 봐야 한다 —
 * 두 곳에서 따로 세면 화면 위아래가 서로 다른 말을 하게 된다.
 */
export function battleTally(battle: BattleState | null) {
  const injured = battle
    ? battle.pairs.filter((p) => p.hunter.hp > 0 && p.hunter.hp < p.hunter.maxHp * 0.7).length
    : 0;
  const down = battle ? battle.pairs.filter((p) => p.hunter.hp <= 0).length : 0;
  const readyCount = battle ? battle.pairs.filter(pairReady).length : 0;

  /** 아직 제출하지 않은 쪽 — 자동 행동이거나 쓰러진 헌터는 기다릴 것이 없다 */
  const waitingSides = battle
    ? battle.pairs.flatMap((pair) => {
        const rows: Array<{ pairId: string; label: string; side: ActorSide }> = [];
        if (!pair.submission.hunterSubmitted && pair.hunter.control !== 'AUTO' && pair.hunter.hp > 0) {
          rows.push({ pairId: pair.id, label: pair.label, side: 'HUNTER' });
        }
        if (!pair.submission.constellationSubmitted && pair.constellation.control !== 'AUTO') {
          rows.push({ pairId: pair.id, label: pair.label, side: 'CONSTELLATION' });
        }
        return rows;
      })
    : [];

  return { injured, down, readyCount, waitingSides };
}
