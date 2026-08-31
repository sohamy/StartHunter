/**
 * 운영진 중앙 작전실.
 *
 * 작업 단위로 화면을 나눈다.
 *   ROSTER     영구 편성 — 페어는 한 번 맺으면 유지된다
 *   SHEET      참가자 시트 — 스탯 · 스킬 · 컨셉 전문 열람
 *   ENCOUNTER  적 세팅 — 층에 배치할 적을 만들어 둔다
 *   OPERATION  전투 — 참가 페어와 적을 골라 시작하고, 라운드를 처리한다
 *   LOG        시스템 · 연출 로그
 *
 * 원칙: 자동 판정 결과를 운영진이 언제든 덮어쓸 수 있어야 한다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { GIMMICK_CHECK, GIMMICK_DEFINITIONS, findGimmick } from '../config/gimmicks';
import { DEFAULT_INVENTORY, ITEM_DEFINITIONS, describeItem, findItem } from '../config/items';
import { PATTERN_SETS, findPatternSet } from '../config/patterns';
import { manualRewards } from '../config/rewards';
import { PROFILE_FIELDS } from '../config/characters';
import { CONSTELLATION_STAGES, CONTRACT_STAGES } from '../config/rules';
import { DEFAULT_OPERATION, DEFAULT_POINTS } from '../config/scenario';
import { applyShopCatalog, shopRows } from '../config/shop';
import { STATUS_DEFINITIONS } from '../config/status';
import * as admin from '../engine/admin';
import {
  assembleBattle,
  enemyFromTemplate,
  pairReady,
  type BondEntry,
} from '../engine/battle';
import {
  describePhaseBands,
  nextPatternAdmin,
  normalizeCutoffs,
  patternSetToPreset,
} from '../engine/enemy';
import { availableStage, gimmickBrief } from '../engine/gimmick';
import { newUuid } from '../engine/id';
import { buildRecord, settle, type SettlementTarget } from '../engine/record';
import { actionAvailability, applyRound, previewRound } from '../engine/round';
import { purchase, refund, withPurchase } from '../engine/shop';
import { actionsFor } from '../engine/skills';
import { injuryOf, statusViews } from '../engine/status';
import {
  AuthError,
  getAuth,
  getServerAuth,
  getServerStorage,
  getStorage,
  isServerMode,
  toPublicProfile,
  type PublicProfile,
  type SheetRecord,
} from '../store';
import AttackEditor from './AttackEditor';
import ShopEditor from './ShopEditor';
import ChatPanel from './ChatPanel';
import Collapsible from './Collapsible';
import SheetEditor from './SheetEditor';
import { ActorSheet, PublicSheetCard, SheetDetail, sideLabel, type Supply } from './SheetView';
import type {
  ActorSide,
  BattleRecord,
  BattleState,
  BattleSummary,
  CharacterSheet,
  ShopItemRecord,
  ConstellationStage,
  ContractStage,
  EnemyState,
  EnemyTemplate,
  PairBond,
  RoundPreview,
  StatusEffect,
  StatusHolder,
} from '../types';

type Tab = 'ROSTER' | 'SHEET' | 'SHOP' | 'ENCOUNTER' | 'OPERATION' | 'LOG' | 'ARCHIVE';
type PairFilter = 'ALL' | 'GOVERNMENT' | 'GUILD' | 'INJURED' | 'DOWN' | 'NOT_SUBMITTED';
type SheetFilter = 'ALL' | 'HUNTER' | 'CONSTELLATION' | 'UNPAIRED';

/**
 * 참가자에게 남길 공개 시트 주소.
 *
 * 이 주소로 열리는 화면에는 공개분만 뜬다 — 스탯도 스킬 수치도 담기지 않는다.
 * 커뮤니티에 그대로 붙여 넣을 수 있도록 절대 주소로 만든다.
 */
function publicSheetUrl(accountId: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const path = `${base}/battle/sheet/?id=${encodeURIComponent(accountId)}`;
  return typeof window === 'undefined' ? path : `${window.location.origin}${path}`;
}

/** 공개 시트 주소 한 줄 — 눈으로 확인하고, 눌러서 복사하고, 열어 볼 수 있게 한다. */
function PublicSheetLink({ accountId }: { accountId: string }) {
  const url = publicSheetUrl(accountId);
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
      <span className="field-label">공개 주소</span>
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
/** 시트 전문(수치까지) 과 참가자에게 보이는 프로필 카드를 오간다 */
type SheetLayout = 'DETAIL' | 'PROFILE';
type LogTab = 'SYSTEM' | 'ROLEPLAY';

/**
 * 전투 편성 프리셋.
 *
 * 같은 페어 · 같은 적 조합을 매번 다시 고르는 일이 잦다.
 * 서버 스키마를 건드리지 않으려고 운영자 브라우저에만 남긴다.
 */
interface OperationPreset {
  id: string;
  name: string;
  bondIds: string[];
  enemyIds: string[];
  gimmickId: string;
  floor: number;
}

const PRESET_KEY = 'tower-raid.operation-presets';

function loadPresets(): OperationPreset[] {
  try {
    const raw = window.localStorage.getItem(PRESET_KEY);
    const rows: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(rows) ? (rows as OperationPreset[]) : [];
  } catch {
    return [];
  }
}

function terminalUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/battle/`;
}

/** 되돌리기 어려운 조작은 한 번 되묻는다 */
function confirmed(message: string): boolean {
  return typeof window === 'undefined' || window.confirm(message);
}

/** 목록에 쓰는 짧은 시각 표기 */
function shortTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

/** 서버 기본키가 uuid 이므로 클라이언트도 uuid 를 만든다 */
function newId(): string {
  return newUuid();
}

/* ── 공용 요소 ─────────────────────────────────────────── */

function NumberField({
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

function TextField({
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

function Bar({ value, max, tone }: { value: number; max: number; tone: string }) {
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`gauge tone-${tone}`}>
      <div className="gauge-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

function StatusEditor({
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

/* ── 본체 ──────────────────────────────────────────────── */

export default function ControlTerminal() {
  const storage = useMemo(() => getStorage(), []);
  const serverStorage = useMemo(() => getServerStorage(), []);
  const auth = useMemo(() => getAuth(), []);
  const serverAuth = useMemo(() => getServerAuth(), []);

  const [tab, setTab] = useState<Tab>('OPERATION');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [operatorHandle, setOperatorHandle] = useState('관리국');

  // 인증
  const [access, setAccess] = useState<'CHECKING' | 'LOCAL' | 'DENIED' | 'GRANTED'>(
    isServerMode() ? 'CHECKING' : 'LOCAL',
  );
  const [operatorId, setOperatorId] = useState('');
  const [operatorPassword, setOperatorPassword] = useState('');

  // 데이터
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  const [sheets, setSheets] = useState<SheetRecord[]>([]);
  const [bonds, setBonds] = useState<PairBond[]>([]);
  const [templates, setTemplates] = useState<EnemyTemplate[]>([]);
  const [records, setRecords] = useState<BattleRecord[]>([]);
  const [battles, setBattles] = useState<BattleSummary[]>([]);
  const [battle, setBattle] = useState<BattleState | null>(null);
  const [preview, setPreview] = useState<RoundPreview | null>(null);

  // 편성 입력
  const [pairingHunter, setPairingHunter] = useState('');
  const [pairingConstellation, setPairingConstellation] = useState('');

  // 전투 편성 입력
  const [selectedBonds, setSelectedBonds] = useState<string[]>([]);
  const [selectedEnemies, setSelectedEnemies] = useState<string[]>([]);
  const [gimmickId, setGimmickId] = useState<string>('gimmick.seal');
  const [floor, setFloor] = useState<number>(DEFAULT_OPERATION.floor);

  const [filter, setFilter] = useState<PairFilter>('ALL');
  const [sheetFilter, setSheetFilter] = useState<SheetFilter>('ALL');
  const [sheetLayout, setSheetLayout] = useState<SheetLayout>('DETAIL');
  const [shopItems, setShopItems] = useState<ShopItemRecord[]>([]);
  const [sheetQuery, setSheetQuery] = useState('');
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null);
  const [logTab, setLogTab] = useState<LogTab>('SYSTEM');
  /** 페어가 늘면 카드 하나가 화면 한 장을 먹는다 — 기본은 접어 둔다 */
  const [monitorDense, setMonitorDense] = useState(true);
  /** 일괄 조작 대상 페어 */
  const [bulkPairs, setBulkPairs] = useState<string[]>([]);
  /** 직전 확정을 한 번만 되돌린다 — 손으로 수치를 복원하는 일을 없앤다 */
  const [undoBattle, setUndoBattle] = useState<BattleState | null>(null);
  const [presets, setPresets] = useState<OperationPreset[]>([]);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [logDraft, setLogDraft] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  /** 운영 도크에서 곧장 뛰어갈 자리들 — 긴 화면을 오르내리지 않게 한다 */
  const processRef = useRef<HTMLElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  /**
   * 자동 보관용 참조.
   * 보관 함수는 아래에서 선언되므로, 위쪽 효과에서 쓰려면 참조를 거쳐야 한다.
   */
  const archiveBattleRef = useRef<((state: BattleState, silent?: boolean) => Promise<void>) | null>(
    null,
  );

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [profileRows, sheetRows, bondRows, templateRows, battleRows, recordRows, shopRecords] =
        await Promise.all([
          auth.listProfiles(),
          auth.listSheets(),
          storage.listBonds(),
          storage.listEnemyTemplates(),
          storage.listBattles(),
          storage.listRecords(),
          storage.listShopItems(),
        ]);
      setProfiles(profileRows);
      setSheets(sheetRows);
      setBonds(bondRows);
      setTemplates(templateRows);
      setBattles(battleRows);
      setRecords(recordRows);
      // 진열을 config 에 실어야 상점 · 창구 · 전투 판정이 같은 목록을 본다
      applyShopCatalog(shopRecords);
      setShopItems(shopRecords);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `데이터를 불러올 수 없습니다: ${caught.message}`
          : '데이터를 불러올 수 없습니다.',
      );
    }
  }, [auth, storage]);

  useEffect(() => {
    if (access === 'GRANTED' || access === 'LOCAL') void refresh();
  }, [access, refresh]);

  useEffect(() => setPresets(loadPresets()), []);

  /** 전투가 바뀌면 되돌리기와 일괄 선택은 의미가 없다 */
  useEffect(() => {
    setUndoBattle(null);
    setBulkPairs([]);
  }, [battle?.id]);

  useEffect(() => {
    (async () => {
      if (!serverAuth) return;
      const session = await serverAuth.currentSession();
      if (!session) {
        setAccess('DENIED');
        return;
      }
      setAccess((await serverAuth.isOperator()) ? 'GRANTED' : 'DENIED');
    })();
  }, [serverAuth]);

  useEffect(() => {
    if (!battle) return;
    // 저장 실패(권한 · 스키마 · 계정 불일치)를 조용히 삼키면 운영 중에 원인을 알 수 없다.
    void storage.saveBattle(battle).catch((caught: unknown) => {
      setError(caught instanceof Error ? `전투 저장 실패: ${caught.message}` : '전투 저장 실패');
    });
  }, [battle, storage]);

  /**
   * 전투가 끝나면 곧바로 기록으로 남긴다.
   *
   * 운영진이 잊고 새 전투를 열면 결과와 포인트 근거가 사라진다.
   * 같은 결과로 이미 보관된 기록이 있으면 다시 만들지 않는다.
   */
  useEffect(() => {
    if (!battle) return;
    if (battle.status !== 'CLEARED' && battle.status !== 'FAILED') return;
    if (records.some((row) => row.battleId === battle.id && row.status === battle.status)) return;
    void archiveBattleRef.current?.(battle, true);
  }, [battle, records]);

  const update = useCallback((next: BattleState) => {
    setBattle(next);
    setPreview(null);
  }, []);

  /**
   * 참가자의 제출만 가져와 덮는다.
   *
   * 전투 상태 전체를 다시 읽으면 운영진이 지금 고치고 있는 수치를 덮어쓸 수 있다.
   * 참가자가 바꿀 수 있는 것은 제출뿐이므로 그것만 반영한다.
   * 바뀐 게 없으면 같은 객체를 돌려줘 저장 루프가 돌지 않게 한다.
   */
  const syncSubmissions = useCallback(
    async (battleId: string) => {
      const remote = await storage.loadBattle(battleId);
      if (!remote) return;

      setBattle((current) => {
        if (!current || current.id !== remote.id || current.round !== remote.round) return current;

        const changed = remote.pairs.some((row) => {
          const mine = current.pairs.find((candidate) => candidate.id === row.id);
          return mine && JSON.stringify(mine.submission) !== JSON.stringify(row.submission);
        });
        if (!changed) return current;

        return {
          ...current,
          pairs: current.pairs.map((pair) => {
            const row = remote.pairs.find((candidate) => candidate.id === pair.id);
            return row ? { ...pair, submission: row.submission } : pair;
          }),
        };
      });
    },
    [storage],
  );

  /** 제출이 들어오는 것을 실시간으로 본다 — 새로고침을 눌러야 보이면 운영이 불가능하다 */
  useEffect(() => {
    const id = battle?.id;
    if (!id || !serverStorage) return;

    const stop = serverStorage.subscribe(id, () => void syncSubmissions(id));
    const timer = window.setInterval(() => void syncSubmissions(id), 10000);
    return () => {
      stop();
      window.clearInterval(timer);
    };
  }, [battle?.id, serverStorage, syncSubmissions]);

  /** 새로고침 후에도 진행 중인 전투를 다시 찾아 열지 않아도 되게 한다 */
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || battle) return;
    const live = battles.find((row) => row.status === 'ENGAGED');
    if (!live) return;

    autoOpened.current = true;
    void (async () => {
      const loaded = await storage.loadBattle(live.id);
      if (!loaded) return;
      setBattle(loaded);
      setMessage(`진행 중인 전투를 열었습니다 — ${live.operationName} · ROUND ${live.round}`);
    })();
  }, [battle, battles, storage]);

  /** 알림은 스스로 사라진다. 오류는 남긴다. */
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 6000);
    return () => window.clearTimeout(timer);
  }, [message]);

  /**
   * 저장 실패를 조용히 삼키지 않는다.
   * 테이블이 없거나 권한이 없으면 화면에 그대로 띄운다.
   */
  const guard = useCallback(async (task: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await task();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '작업에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * 활동명으로 시트를 찾는다.
   * 편성(PairBond)과 전투 상태는 계정을 활동명으로 참조한다.
   */
  const sheetOf = useCallback(
    (accountId: string | null): CharacterSheet | null =>
      accountId ? (sheets.find((row) => row.accountId === accountId)?.sheet ?? null) : null,
    [sheets],
  );

  /* ── 인증 ────────────────────────────────────────── */

  const operatorLogin = async () => {
    if (!serverAuth) return;
    setBusy(true);
    setMessage(null);
    try {
      await serverAuth.login({ id: operatorId, password: operatorPassword });
      if (await serverAuth.isOperator()) {
        setOperatorHandle(operatorId);
        setAccess('GRANTED');
      }
      else setMessage('이 계정은 운영진 권한이 없습니다. profiles.role 을 OPERATOR 로 변경하세요.');
    } catch (error) {
      setMessage(error instanceof AuthError ? error.message : '접속에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  if (access === 'CHECKING') {
    return <div className="console-loading">VERIFYING OPERATOR CLEARANCE…</div>;
  }

  if (access === 'DENIED') {
    return (
      <div className="console">
        <header className="console-head">
          <div className="agency">
            <b>HUNTER MANAGEMENT AGENCY</b>
            <span>CENTRAL RAID CONTROL</span>
          </div>
          <span className="tag critical">CLEARANCE REQUIRED</span>
        </header>
        {message && <p className="notice error">{message}</p>}
        <section className="panel form">
          <h2 className="panel-title">OPERATOR ACCESS</h2>
          <label className="input-row">
            <span className="field-label">활동명</span>
            <input
              className="ctl input"
              value={operatorId}
              onChange={(event) => setOperatorId(event.target.value)}
              autoComplete="username"
            />
          </label>
          <label className="input-row">
            <span className="field-label">비밀번호</span>
            <input
              className="ctl input"
              type="password"
              value={operatorPassword}
              onChange={(event) => setOperatorPassword(event.target.value)}
              autoComplete="current-password"
              onKeyDown={(event) => {
                if (event.key === 'Enter') void operatorLogin();
              }}
            />
          </label>
          <button
            type="button"
            className="confirm-btn"
            disabled={busy || !operatorId || !operatorPassword}
            onClick={() => void operatorLogin()}
          >
            CONNECT
          </button>
        </section>
      </div>
    );
  }

  /* ── 편성 조작 ───────────────────────────────────── */

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

  /* ── 참가자 시트 조작 ────────────────────────────── */

  const saveSheet = async (accountId: string, next: CharacterSheet) => {
    await guard(async () => {
      await auth.updateSheet(accountId, next);
      await refresh();
      setEditingSheetId(null);
      setMessage(`${next.name} 시트를 저장했습니다.`);
    });
  };

  const deleteSheet = async (accountId: string, sheet: CharacterSheet, bondLabel?: string) => {
    const warning = bondLabel
      ? `${sheet.name} (@${accountId}) 의 시트를 삭제합니다.\n이 참가자는 ${bondLabel} 에 편성되어 있습니다 — 편성 기록은 남습니다.\n되돌릴 수 없습니다.`
      : `${sheet.name} (@${accountId}) 의 시트를 삭제합니다. 되돌릴 수 없습니다.`;
    if (!confirmed(warning)) return;

    await guard(async () => {
      await auth.deleteSheet(sheet.id);
      await refresh();
      setEditingSheetId(null);
      setMessage(`${sheet.name} 시트를 삭제했습니다.`);
    });
  };

  /* ── 적 세팅 조작 ────────────────────────────────── */

  const addTemplate = async (boss: boolean) => {
    const template: EnemyTemplate = {
      id: newId(),
      name: boss ? '새 보스' : '새 몬스터',
      grade: boss ? 'BOSS / A' : 'NORMAL / C',
      maxHp: boss ? 1000 : 180,
      attack: boss ? 14 : 9,
      defense: boss ? 6 : 3,
      maxPhase: boss ? 3 : 1,
      patternSetId: boss ? 'set.star_devourer' : 'set.husk',
      attacks: [],
      phaseCutoffs: [],
      boss,
    };
    await guard(async () => {
      await storage.saveEnemyTemplate(template);
      await refresh();
      setMessage(`${template.name} 추가됨 — 이름과 수치를 편집하세요.`);
    });
  };

  const patchTemplate = async (template: EnemyTemplate, patch: Partial<EnemyTemplate>) => {
    await guard(async () => {
      await storage.saveEnemyTemplate({ ...template, ...patch });
      await refresh();
    });
  };

  /**
   * 프리셋 패턴을 편집 가능한 공격 목록으로 펼친다.
   *
   * 프리셋은 코드에 있어 고칠 수 없다 — 한 번 펼쳐 두면 그 보스만의 패턴으로
   * 이름 · 계수 · 예고 · 주기까지 전부 운영진이 손볼 수 있다.
   */
  const importPreset = async (template: EnemyTemplate) => {
    const preset = patternSetToPreset(template.patternSetId ?? null);
    if (!preset) {
      setMessage('불러올 프리셋 패턴을 먼저 고르세요.');
      return;
    }
    const current = (template.attacks ?? []).length;
    if (
      current > 0 &&
      !confirmed(`${template.name} 에 만들어 둔 공격 ${current}개를 프리셋으로 덮어씁니다.`)
    ) {
      return;
    }

    await patchTemplate(template, {
      attacks: preset.attacks,
      phaseCutoffs: preset.phaseCutoffs,
      maxPhase: Math.max(template.maxPhase, preset.maxPhase),
    });
    setMessage(
      `${findPatternSet(template.patternSetId ?? null)?.labelKo} 패턴을 불러왔습니다 — 이제 자유롭게 고칠 수 있습니다.`,
    );
  };

  /* ── 전투 시작 ───────────────────────────────────── */

  const startOperation = async () => {
    if (selectedBonds.length === 0) {
      setMessage('참가할 페어를 선택하세요.');
      return;
    }
    if (selectedEnemies.length === 0) {
      setMessage('배치할 적을 선택하세요.');
      return;
    }

    // 이미 불러온 시트 목록을 먼저 쓰고, 없을 때만 서버에 다시 묻는다.
    const loadSheet = async (accountId: string | null): Promise<CharacterSheet | null> => {
      if (!accountId) return null;
      return sheetOf(accountId) ?? (await auth.getAccount(accountId))?.sheet ?? null;
    };

    const entries: BondEntry[] = [];
    for (const bondId of selectedBonds) {
      const bond = bonds.find((row) => row.id === bondId);
      if (!bond) continue;

      const hunterSheet = await loadSheet(bond.hunterAccountId);
      const constellationSheet = await loadSheet(bond.constellationAccountId);

      if (!hunterSheet || !constellationSheet) {
        const missing = [
          hunterSheet ? null : `헌터 ${bond.hunterAccountId ?? '미지정'}`,
          constellationSheet ? null : `성좌 ${bond.constellationAccountId ?? '미지정'}`,
        ]
          .filter(Boolean)
          .join(' · ');
        setMessage(`${bond.label} 의 시트를 불러올 수 없습니다 — ${missing}`);
        return;
      }

      entries.push({ bond, hunterSheet, constellationSheet });
    }

    const enemies: EnemyState[] = selectedEnemies
      .map((id, index) => {
        const template = templates.find((row) => row.id === id);
        return template ? enemyFromTemplate(template, index) : null;
      })
      .filter((row): row is EnemyState => row !== null);

    const next = assembleBattle({
      id: newId(),
      mode: entries.length > 1 ? 'RAID' : 'DUEL',
      operation: { ...DEFAULT_OPERATION, floor },
      entries,
      enemies,
      gimmickId: gimmickId || null,
    });

    setBusy(true);
    setError(null);
    try {
      // 저장이 실패하면 참가자 단말에 전투가 열리지 않는다 — 반드시 알린다.
      await storage.saveBattle(next);
      setBattle(next);
      setPreview(null);
      autoOpened.current = true;
      setTab('OPERATION');
      setMessage(
        `FLOOR ${floor} 전투를 시작했습니다. 참가자 단말이 자동으로 전투 화면으로 넘어갑니다.`,
      );
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `전투를 시작하지 못했습니다: ${caught.message}`
          : '전투를 시작하지 못했습니다.',
      );
    } finally {
      setBusy(false);
    }
  };

  /* ── 데이터 입출력 ───────────────────────────────── */

  const exportJson = async () => {
    const json = await storage.exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tower-raid-backup.json';
    link.click();
    URL.revokeObjectURL(url);
    setMessage('전투 데이터를 내보냈습니다.');
  };

  const importJson = async (file: File) => {
    try {
      await storage.importAll(await file.text());
      await refresh();
      setMessage('데이터를 불러왔습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '불러오기에 실패했습니다.');
    }
  };

  /* ── 공략 기록 ───────────────────────────────────── */

  /** 끝난 전투를 기록으로 보관한다. 같은 전투를 두 번 보관하지 않는다. */
  const archiveBattle = async (state: BattleState, silent = false) => {
    if (records.some((row) => row.battleId === state.id && row.status === state.status)) {
      if (!silent) setMessage('이미 같은 결과로 보관된 기록이 있습니다.');
      return;
    }
    await guard(async () => {
      await storage.saveRecord(buildRecord(state, new Date()));
      await refresh();
      if (!silent) setMessage('공략 기록으로 보관했습니다.');
    });
  };

  /**
   * 기록의 포인트와 소모된 보급품을 **개인 시트**에 반영한다.
   * 소지금과 가방은 개인 소유라 페어가 아니라 사람마다 반영한다.
   */
  const settleRecord = async (record: BattleRecord) => {
    const targets: SettlementTarget[] = sheets.map((row) => ({
      accountId: row.accountId,
      side: row.sheet.side,
      points: row.sheet.points ?? 0,
      inventory: row.sheet.inventory ?? [],
    }));

    const result = settle(record, bonds, targets);
    if (result.rows.length === 0) {
      setMessage('정산할 항목이 없습니다 — 얻은 포인트가 없거나 시트를 불러오지 못했습니다.');
      return;
    }
    if (
      !confirmed(
        `${result.rows.length}명에게 포인트를 반영합니다.\n` +
          result.rows
            .map((row) => `${row.name} (${row.label}) ${row.pointsBefore} → ${row.pointsAfter}`)
            .join('\n'),
      )
    ) {
      return;
    }

    await guard(async () => {
      const changed = new Set(result.rows.map((row) => row.accountId));
      for (const target of result.targets) {
        if (!changed.has(target.accountId)) continue;
        const owner = sheets.find((row) => row.accountId === target.accountId);
        if (!owner) continue;
        await auth.updateSheet(target.accountId, {
          ...owner.sheet,
          points: target.points,
          inventory: target.inventory,
        });
      }
      await storage.saveRecord({
        ...record,
        note: `${record.note}\n[정산 완료]`.trim(),
      });
      await refresh();
      setMessage(`정산 완료 — ${result.rows.map((row) => `${row.name} +${row.earned}P`).join(' · ')}`);
    });
  };

  archiveBattleRef.current = archiveBattle;

  const removeRecord = async (record: BattleRecord) => {
    if (!confirmed(`${record.operation.name} 기록을 삭제합니다.`)) return;
    await guard(async () => {
      await storage.deleteRecord(record.id);
      await refresh();
      setMessage('기록을 삭제했습니다.');
    });
  };

  /* ── 상점 진열 ───────────────────────────────────── */

  const saveShopRow = async (record: ShopItemRecord) => {
    await guard(async () => {
      await storage.saveShopItem(record);
      await refresh();
      setMessage(`상점에 반영했습니다 — ${record.item?.nameKo ?? record.itemId}`);
    });
  };

  const removeShopRow = async (itemId: string) => {
    if (!confirmed(`${itemId} 을(를) 진열에서 지웁니다.`)) return;
    await guard(async () => {
      await storage.deleteShopItem(itemId);
      await refresh();
      setMessage('진열에서 지웠습니다.');
    });
  };

  /* ── 보급 창구 ───────────────────────────────────── */

  /** 소지금과 가방은 개인 것이라, 창구도 사람 단위로 연다 */
  const buyForSheet = async (row: SheetRecord, itemId: string) => {
    const result = purchase(row.sheet, itemId, 1);
    if (!result.ok) {
      setError(result.reason ?? '구매에 실패했습니다.');
      return;
    }
    await guard(async () => {
      await auth.updateSheet(row.accountId, withPurchase(row.sheet, result));
      await refresh();
      setMessage(`${row.sheet.name} — ${result.message}`);
    });
  };

  const sellForSheet = async (row: SheetRecord, itemId: string) => {
    const result = refund(row.sheet, itemId);
    if (!result.ok) {
      setError(result.reason ?? '반납에 실패했습니다.');
      return;
    }
    await guard(async () => {
      await auth.updateSheet(row.accountId, withPurchase(row.sheet, result));
      await refresh();
      setMessage(`${row.sheet.name} — ${result.message}`);
    });
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage('클립보드에 복사했습니다.');
    } catch {
      setMessage('복사에 실패했습니다.');
    }
  };

  /* ── 전투 파생값 ─────────────────────────────────── */

  const activeBonds = bonds.filter((row) => row.active);
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

  /** 시트 소유자가 속한 활성 페어 */
  const bondOf = (accountId: string) =>
    activeBonds.find(
      (bond) =>
        bond.hunterAccountId === accountId || bond.constellationAccountId === accountId,
    ) ?? null;

  /** 개인 지갑과 가방 — 시트에 붙어 있다 */
  const supplyOf = (accountId: string): Supply | null => {
    const sheet = sheetOf(accountId);
    if (!sheet) return null;
    return { points: sheet.points ?? 0, inventory: sheet.inventory ?? [] };
  };

  /** 컨셉 세 칸과 계약 상대를 한 덩어리로 묶어 검색에 태운다 */
  const profileText = (sheet: CharacterSheet) =>
    [sheet.partnerName, ...PROFILE_FIELDS.map((field) => sheet[field.key] ?? '')]
      .join(' ')
      .toLowerCase();

  const query = sheetQuery.trim().toLowerCase();
  const filteredSheets = sheets
    .filter((row) => {
      switch (sheetFilter) {
        case 'HUNTER':
          return row.sheet.side === 'HUNTER';
        case 'CONSTELLATION':
          return row.sheet.side === 'CONSTELLATION';
        case 'UNPAIRED':
          return !bondOf(row.accountId);
        default:
          return true;
      }
    })
    .filter(
      (row) =>
        !query ||
        row.sheet.name.toLowerCase().includes(query) ||
        row.accountId.toLowerCase().includes(query) ||
        row.sheet.classId.toLowerCase().includes(query) ||
        profileText(row.sheet).includes(query) ||
        (row.sheet.skills ?? []).some((skill) => skill.name.toLowerCase().includes(query)),
    );

  const injured = battle
    ? battle.pairs.filter((p) => p.hunter.hp > 0 && p.hunter.hp < p.hunter.maxHp * 0.7).length
    : 0;
  const down = battle ? battle.pairs.filter((p) => p.hunter.hp <= 0).length : 0;
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

  const filteredPairs = (battle?.pairs ?? []).filter((pair) => {
    switch (filter) {
      case 'GOVERNMENT':
        return pair.affiliation === 'GOVERNMENT';
      case 'GUILD':
        return pair.affiliation === 'PRIVATE_GUILD';
      case 'INJURED':
        return pair.hunter.hp > 0 && pair.hunter.hp < pair.hunter.maxHp * 0.7;
      case 'DOWN':
        return pair.hunter.hp <= 0;
      case 'NOT_SUBMITTED':
        return waitingSides.some((row) => row.pairId === pair.id);
      default:
        return true;
    }
  });

  const patchPreviewPair = (pairId: string, patch: Partial<RoundPreview['pairs'][number]>) => {
    if (!preview) return;
    setPreview({
      ...preview,
      pairs: preview.pairs.map((row) => (row.pairId === pairId ? { ...row, ...patch } : row)),
    });
  };

  const patchPreviewEnemy = (enemyId: string, damage: number) => {
    if (!preview) return;
    setPreview({
      ...preview,
      enemies: preview.enemies.map((row) => {
        if (row.enemyId !== enemyId) return row;
        const ratio = row.damageToHunter > 0 ? damage / row.damageToHunter : 0;
        return {
          ...row,
          damageToHunter: damage,
          hits: row.hits.map((hit) => ({
            ...hit,
            damage: row.hits.length === 1 ? damage : Math.round(hit.damage * ratio),
          })),
        };
      }),
    });
  };

  const readyCount = battle ? battle.pairs.filter(pairReady).length : 0;

  /** 그 페어가 지금 겨누고 있는 적 — 참가자 시점 미리보기에 쓴다 */
  const peekTarget = (pair: BattleState['pairs'][number]): EnemyState | null => {
    if (!battle) return null;
    return (
      battle.enemies.find((row) => row.id === pair.submission.targetEnemyId) ??
      battle.enemies[0] ??
      null
    );
  };

  /**
   * 편성한 적과 층 기믹이 서로 맞는지 본다.
   * 포식처럼 기믹 해제를 전제로 한 패턴은 장치 없이 세우면 받아 낼 방법이 없다.
   */
  const gimmickWarning: string | null = (() => {
    const picked = selectedEnemies
      .map((id) => templates.find((row) => row.id === id))
      .filter((row): row is EnemyTemplate => Boolean(row));

    const needs = picked.filter(
      (row) => findPatternSet(row.patternSetId ?? null)?.requiresGimmick,
    );
    if (!gimmickId && needs.length > 0) {
      return `${needs.map((row) => row.name).join(' · ')} 의 패턴은 층 기믹 해제를 전제로 합니다. 기믹을 고르거나, 기믹 없이도 성립하는 패턴 세트로 바꾸세요.`;
    }
    if (gimmickId && picked.length > 0 && needs.length === 0) {
      return '고른 적 중 기믹을 전제로 한 패턴이 없습니다. 기믹은 별도의 목표로만 굴러갑니다.';
    }
    return null;
  })();

  const jumpTo = (ref: { current: HTMLElement | null }) =>
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  /** 라운드 계산 — 어디서 눌러도 결과표 앞으로 데려간다 */
  const computeRound = () => {
    if (!battle) return;
    setPreview(previewRound(battle));
    window.requestAnimationFrame(() => jumpTo(processRef));
  };

  /** 결과 확정 — 도크와 표에서 같은 동작을 쓴다 */
  const applyPreview = () => {
    if (!battle || !preview) return;
    // 확정 직전 상태를 한 장 남긴다. 잘못 넣은 수치를 손으로 복원하지 않게 한다.
    setUndoBattle(battle);
    setBattle(applyRound(battle, preview));
    setPreview(null);
    setMessage(
      `ROUND ${battle.round} 결과를 확정했습니다. 연출 로그가 만들어졌고 참가자 화면이 갱신됩니다.`,
    );
  };

  /** 직전 확정을 되돌린다 — 한 단계만 남는다 */
  const undoApply = () => {
    if (!undoBattle) return;
    if (
      !confirmed(
        `ROUND ${undoBattle.round} 확정을 되돌립니다. 그 뒤에 손으로 고친 수치도 함께 사라집니다.`,
      )
    ) {
      return;
    }
    setBattle(undoBattle);
    setPreview(null);
    setUndoBattle(null);
    setMessage(`ROUND ${undoBattle.round} 직전 상태로 되돌렸습니다.`);
  };

  /**
   * 선택한 페어에 같은 조작을 한 번에 건다.
   * 페어가 여섯 조만 되어도 하나씩 여는 것이 일이 된다.
   */
  const runBulk = (label: string, step: (state: BattleState, pairId: string) => BattleState) => {
    if (!battle || bulkPairs.length === 0) return;
    let next = battle;
    for (const pairId of bulkPairs) next = step(next, pairId);
    update(next);
    setMessage(`${bulkPairs.length}개 페어 — ${label}`);
  };

  /** 그 페어의 모든 상태이상을 걷어낸다 */
  const clearStatuses = (state: BattleState, pairId: string): BattleState => {
    const pair = state.pairs.find((row) => row.id === pairId);
    if (!pair) return state;
    let next = state;
    for (const status of pair.hunter.statuses) {
      next = admin.revokeStatus(next, 'HUNTER', pairId, status.defId);
    }
    for (const status of pair.constellation.statuses) {
      next = admin.revokeStatus(next, 'CONSTELLATION', pairId, status.defId);
    }
    return next;
  };

  const savePresets = (rows: OperationPreset[]) => {
    setPresets(rows);
    try {
      window.localStorage.setItem(PRESET_KEY, JSON.stringify(rows));
    } catch {
      setError('프리셋을 저장할 수 없습니다 (브라우저 저장소 제한).');
    }
  };

  const capturePreset = () => {
    const name = window.prompt(
      '프리셋 이름',
      `FLOOR ${floor} · ${selectedBonds.length}페어`,
    );
    if (!name) return;
    savePresets([
      ...presets.filter((row) => row.name !== name),
      {
        id: newId(),
        name,
        bondIds: [...selectedBonds],
        enemyIds: [...selectedEnemies],
        gimmickId,
        floor,
      },
    ]);
    setMessage(`프리셋 「${name}」 을 저장했습니다.`);
  };

  /** 지금 명부에 남아 있는 것만 되살린다 — 지워진 페어 · 적은 조용히 빠진다 */
  const usePreset = (preset: OperationPreset) => {
    const bondIds = preset.bondIds.filter((id) => activeBonds.some((row) => row.id === id));
    const enemyIds = preset.enemyIds.filter((id) => templates.some((row) => row.id === id));
    setSelectedBonds(bondIds);
    setSelectedEnemies(enemyIds);
    setGimmickId(preset.gimmickId);
    setFloor(preset.floor);

    const dropped =
      preset.bondIds.length - bondIds.length + (preset.enemyIds.length - enemyIds.length);
    setMessage(
      dropped > 0
        ? `프리셋 「${preset.name}」 적용 — 사라진 항목 ${dropped}건은 빠졌습니다.`
        : `프리셋 「${preset.name}」 을 불러왔습니다.`,
    );
  };

  /**
   * 미제출자를 채널로 부른다.
   * 누가 안 냈는지 일일이 옮겨 적는 대신 한 번에 올린다.
   */
  const callWaiting = () => {
    if (!battle || waitingSides.length === 0) return;
    const names = waitingSides
      .map((row) => `${row.label} ${row.side === 'HUNTER' ? '헌터' : '성좌'}`)
      .join(' · ');
    void guard(async () => {
      await storage.postMessage({
        id: newUuid(),
        channel: battle.id,
        authorId: operatorHandle,
        authorName: '관리국',
        role: 'OPERATOR',
        side: null,
        kind: 'OOC',
        body: `[제출 요청] ROUND ${battle.round} — ${names} 의 제출을 기다립니다.`,
        dice: null,
        at: new Date().toISOString(),
      });
      setMessage(`채널에 제출 요청을 올렸습니다 (${waitingSides.length}건).`);
    });
  };

  /* ── 화면 ────────────────────────────────────────── */

  return (
    <div className="console wide">
      <header className="console-head">
        <div className="agency">
          <b>HUNTER MANAGEMENT AGENCY</b>
          <span>CENTRAL RAID CONTROL</span>
        </div>
        <dl className="ops">
          <div className="field">
            <span className="field-label">편성된 페어</span>
            <span className="field-value num">{activeBonds.length}</span>
          </div>
          <div className="field">
            <span className="field-label">등록 적</span>
            <span className="field-value num">{templates.length}</span>
          </div>
          {battle && (
            <>
              <div className="field">
                <span className="field-label">FLOOR</span>
                <span className="field-value num">{battle.operation.floor}</span>
              </div>
              <div className="field">
                <span className="field-label">ROUND</span>
                <span className="field-value num">{String(battle.round).padStart(2, '0')}</span>
              </div>
              <div className="field">
                <span className="field-label">준비</span>
                <span className="field-value num">
                  {readyCount}/{battle.pairs.length}
                </span>
              </div>
              <div className="field">
                <span className="field-label">DOWN</span>
                <span className={`field-value num ${down > 0 ? 'danger-text' : ''}`}>{down}</span>
              </div>
            </>
          )}
        </dl>
      </header>

      {/* ── 탭 ── */}
      <nav className="tabbar">
        {(
          [
            ['ROSTER', `편성 · ${activeBonds.length}`],
            ['SHEET', `참가자 시트 · ${sheets.length}`],
            ['SHOP', `상점 · ${shopRows().length}`],
            ['ENCOUNTER', `적 세팅 · ${templates.length}`],
            ['OPERATION', battle ? `전투 · ROUND ${battle.round}` : '전투'],
            ['LOG', '로그'],
            ['ARCHIVE', `공략 기록 · ${records.length}`],
          ] as Array<[Tab, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`tab ${tab === value ? 'on' : ''}`}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
        <div className="tabbar-right">
          {waitingSides.length > 0 && tab !== 'OPERATION' && (
            <button type="button" className="tag warn" onClick={() => setTab('OPERATION')}>
              미제출 {waitingSides.length}
            </button>
          )}
          <a className="ctl small" href={terminalUrl()}>
            참가자 단말 →
          </a>
          {access === 'GRANTED' && (
            <button
              type="button"
              className="ctl small"
              onClick={async () => {
                await auth.logout();
                window.location.reload();
              }}
            >
              로그아웃
            </button>
          )}
        </div>
      </nav>

      {error && (
        <p className="notice error">
          {error}
          <button type="button" className="ctl small" onClick={() => setError(null)}>
            닫기
          </button>
        </p>
      )}
      {message && (
        <p className="notice ok">
          {message}
          <button type="button" className="ctl small" onClick={() => setMessage(null)}>
            닫기
          </button>
        </p>
      )}
      {access === 'LOCAL' && (
        <p className="notice warn">
          LOCAL MODE — 서버에 연결되지 않아 인증 없이 열려 있습니다. 공개 배포 시에는 반드시 서버
          모드로 전환하세요.
        </p>
      )}

      {/* ══════════ 편성 ══════════ */}
      {tab === 'ROSTER' && (
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
                                    title="구매가의 절반을 환급합니다"
                                    onClick={() => void sellForSheet(owner, row.itemId)}
                                  >
                                    반납
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
      )}

      {/* ══════════ 참가자 시트 ══════════ */}
      {tab === 'SHEET' && (
        <section className="panel">
          <div className="process-head">
            <h2 className="panel-title">참가자 시트 · {filteredSheets.length}</h2>
            <div className="btn-row">
              {(
                [
                  ['ALL', `전체 ${sheets.length}`],
                  ['HUNTER', `헌터 ${sheets.filter((r) => r.sheet.side === 'HUNTER').length}`],
                  [
                    'CONSTELLATION',
                    `성좌 ${sheets.filter((r) => r.sheet.side === 'CONSTELLATION').length}`,
                  ],
                  ['UNPAIRED', `미편성 ${sheets.filter((r) => !bondOf(r.accountId)).length}`],
                ] as Array<[SheetFilter, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`ctl small ${sheetFilter === value ? 'on' : ''}`}
                  onClick={() => setSheetFilter(value)}
                >
                  {label}
                </button>
              ))}
              <span className="ctl-sep" />
              {/* 전체 인원 카드는 이 화면(운영진)에만 있다 — 참가자는 자기 것과 페어 상대만 본다 */}
              <button
                type="button"
                className={`ctl small ${sheetLayout === 'DETAIL' ? 'on' : ''}`}
                onClick={() => setSheetLayout('DETAIL')}
              >
                시트 전문
              </button>
              <button
                type="button"
                className={`ctl small ${sheetLayout === 'PROFILE' ? 'on' : ''}`}
                onClick={() => setSheetLayout('PROFILE')}
              >
                프로필 카드
              </button>
              <button type="button" className="ctl small" onClick={() => void refresh()}>
                새로 고침
              </button>
            </div>
          </div>

          <label className="input-row sheet-search">
            <span className="field-label">검색</span>
            <input
              className="ctl input"
              value={sheetQuery}
              placeholder="이름 · 활동명 · 스킬명 · 컨셉"
              onChange={(event) => setSheetQuery(event.target.value)}
            />
          </label>

          {sheets.length === 0 ? (
            <p className="dim">
              불러온 시트가 없습니다.
              {profiles.length > 0 && (
                <>
                  {' '}
                  등록된 참가자는 {profiles.length}명입니다 — 이 계정의 <b>profiles.role</b> 이
                  OPERATOR 가 아니면 서버가 남의 시트를 내려주지 않습니다.
                </>
              )}
            </p>
          ) : filteredSheets.length === 0 ? (
            <p className="dim">조건에 맞는 시트가 없습니다.</p>
          ) : sheetLayout === 'PROFILE' ? (
            <div className="dossier-list">
              {filteredSheets.map((row) => {
                const bond = bondOf(row.accountId);
                const partner = bond
                  ? row.sheet.side === 'HUNTER'
                    ? bond.constellationName
                    : bond.hunterName
                  : null;

                return (
                  <div className="dossier-slot" key={`${row.accountId}-${row.sheet.id}`}>
                    <PublicSheetCard
                      profile={toPublicProfile(row.accountId, row.sheet)}
                      partnerName={partner}
                      supply={supplyOf(row.accountId)}
                      badge={
                        bond ? (
                          <span className="tag ok">{bond.label}</span>
                        ) : (
                          <span className="tag offline">미편성</span>
                        )
                      }
                    />
                    <PublicSheetLink accountId={row.accountId} />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="sheet-list">
              {filteredSheets.map((row) => {
                const bond = bondOf(row.accountId);

                if (editingSheetId === row.sheet.id) {
                  return (
                    <SheetEditor
                      key={`${row.accountId}-${row.sheet.id}`}
                      sheet={row.sheet}
                      accountId={row.accountId}
                      busy={busy}
                      onCancel={() => setEditingSheetId(null)}
                      onSave={(next) => void saveSheet(row.accountId, next)}
                      onDelete={() => void deleteSheet(row.accountId, row.sheet, bond?.label)}
                    />
                  );
                }

                return (
                  <SheetDetail
                    key={`${row.accountId}-${row.sheet.id}`}
                    sheet={row.sheet}
                    accountId={row.accountId}
                    supply={supplyOf(row.accountId)}
                    note={
                      <>
                        {bond ? (
                          <span className="tag ok">{bond.label}</span>
                        ) : (
                          <span className="tag offline">미편성</span>
                        )}
                        <button
                          type="button"
                          className="ctl small"
                          onClick={() => setEditingSheetId(row.sheet.id)}
                        >
                          수정
                        </button>
                      </>
                    }
                  />
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ══════════ 적 세팅 ══════════ */}
      {tab === 'SHOP' && (
        <section className="panel">
          <div className="process-head">
            <h2 className="panel-title">상점 진열 · {shopRows().length}</h2>
            <button type="button" className="ctl small" onClick={() => void refresh()}>
              새로 고침
            </button>
          </div>
          <p className="hint" style={{ marginBottom: 14 }}>
            여기서 넣은 품목은 참가자 상점(<code>/battle/shop/</code>)과 보급 창구에 바로 뜹니다.
            새로 만든 아이템도 전투에서 그대로 쓰입니다 — 효과는 아래 칸에 적은 값으로 판정합니다.
          </p>
          <ShopEditor
            records={shopItems}
            busy={busy}
            onSave={(record) => void saveShopRow(record)}
            onDelete={(itemId) => void removeShopRow(itemId)}
          />
        </section>
      )}

      {tab === 'ENCOUNTER' && (
        <section className="panel">
          <div className="process-head">
            <h2 className="panel-title">적 목록</h2>
            <div className="btn-row">
              <button
                type="button"
                className="ctl primary"
                disabled={busy}
                onClick={() => void addTemplate(true)}
              >
                + 보스 추가
              </button>
              <button
                type="button"
                className="ctl"
                disabled={busy}
                onClick={() => void addTemplate(false)}
              >
                + 일반 몬스터 추가
              </button>
            </div>
          </div>

          {templates.length === 0 ? (
            <p className="dim">등록된 적이 없습니다. 위 버튼으로 추가하세요.</p>
          ) : (
            <div className="enemy-list">
              {templates.map((template) => (
                <article className={`enemy-card ${template.boss ? 'boss' : ''}`} key={template.id}>
                  <div className="enemy-card-head">
                    <span className={`tag ${template.boss ? 'critical' : ''}`}>
                      {template.boss ? 'BOSS' : 'NORMAL'}
                    </span>
                    <b>{template.name}</b>
                    <button
                      type="button"
                      className="ctl small"
                      title="이 적을 삭제합니다"
                      onClick={() => {
                        if (!confirmed(`${template.name} 을 삭제합니다. 되돌릴 수 없습니다.`)) return;
                        void guard(async () => {
                          await storage.deleteEnemyTemplate(template.id);
                          await refresh();
                        });
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="admin-grid">
                    <TextField
                      label="이름"
                      value={template.name}
                      onCommit={(value) => void patchTemplate(template, { name: value })}
                    />
                    <TextField
                      label="등급 표기"
                      value={template.grade}
                      onCommit={(value) => void patchTemplate(template, { grade: value })}
                      placeholder="BOSS / A"
                    />
                    <NumberField
                      label="최대 HP"
                      value={template.maxHp}
                      min={1}
                      step={10}
                      onCommit={(value) => void patchTemplate(template, { maxHp: value })}
                    />
                    <NumberField
                      label="공격력"
                      value={template.attack}
                      onCommit={(value) => void patchTemplate(template, { attack: value })}
                    />
                    <NumberField
                      label="방어력"
                      value={template.defense}
                      onCommit={(value) => void patchTemplate(template, { defense: value })}
                    />
                    <NumberField
                      label="페이즈 수"
                      value={template.maxPhase}
                      min={1}
                      max={5}
                      /* 직접 정한 경계가 있으면 새 페이즈 수에 맞춰 다시 나눈다 */
                      onCommit={(value) =>
                        void patchTemplate(template, {
                          maxPhase: value,
                          phaseCutoffs:
                            (template.phaseCutoffs ?? []).length > 0
                              ? normalizeCutoffs(template.phaseCutoffs, value)
                              : [],
                        })
                      }
                    />
                    <label className="num-field">
                      <span className="field-label">
                        프리셋 패턴 {(template.attacks ?? []).length > 0 && '(사용 안 함)'}
                      </span>
                      <select
                        className="ctl input"
                        value={template.patternSetId ?? ''}
                        disabled={(template.attacks ?? []).length > 0}
                        onChange={(event) =>
                          void patchTemplate(template, { patternSetId: event.target.value || null })
                        }
                      >
                        <option value="">없음 (단일 공격만)</option>
                        {PATTERN_SETS.map((set) => (
                          <option key={set.id} value={set.id}>
                            {set.labelKo}
                          </option>
                        ))}
                      </select>
                      <small className="hint">
                        {findPatternSet(template.patternSetId ?? null)?.note ??
                          '패턴 없이 매 라운드 단일 공격만 합니다.'}
                        {template.patternSetId && (template.attacks ?? []).length === 0 && (
                          <> 아래 <b>보스 패턴</b> 에서 불러오면 그대로 고칠 수 있습니다.</>
                        )}
                      </small>
                    </label>
                    <label className="num-field">
                      <span className="field-label">보스 여부</span>
                      <select
                        className="ctl input"
                        value={template.boss ? 'YES' : 'NO'}
                        onChange={(event) =>
                          void patchTemplate(template, { boss: event.target.value === 'YES' })
                        }
                      >
                        <option value="YES">보스</option>
                        <option value="NO">일반</option>
                      </select>
                    </label>
                  </div>

                  <Collapsible
                    label={`보스 패턴 — 공격 ${(template.attacks ?? []).length}개 · ${describePhaseBands(
                      template,
                    )}`}
                    defaultOpen={(template.attacks ?? []).length > 0}
                  >
                    <AttackEditor
                      attacks={template.attacks ?? []}
                      maxPhase={template.maxPhase}
                      enemyAttack={template.attack}
                      maxHp={template.maxHp}
                      phaseCutoffs={template.phaseCutoffs ?? []}
                      patternSetId={template.patternSetId}
                      onChange={(attacks) => void patchTemplate(template, { attacks })}
                      onPhaseCutoffs={(phaseCutoffs) =>
                        void patchTemplate(template, { phaseCutoffs })
                      }
                      onImportPreset={
                        template.patternSetId ? () => void importPreset(template) : undefined
                      }
                      presetLabel={findPatternSet(template.patternSetId ?? null)?.labelKo}
                    />
                  </Collapsible>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ══════════ 전투 ══════════ */}
      {tab === 'OPERATION' && !battle && (
        <section className="panel">
          <div className="process-head">
            <h2 className="panel-title">전투 편성</h2>
            <span className="hint">등록된 페어 중 참가자를 고르고 적을 배치합니다.</span>
          </div>

          <h3 className="sub-title">참가 페어 ({selectedBonds.length})</h3>
          {activeBonds.length === 0 ? (
            <p className="dim">
              편성된 페어가 없습니다. <b>편성</b> 탭에서 먼저 짝을 맺으세요.
            </p>
          ) : (
            <div className="pick-grid">
              {activeBonds.map((bond) => (
                <button
                  key={bond.id}
                  type="button"
                  className={`pick-card ${selectedBonds.includes(bond.id) ? 'on' : ''}`}
                  onClick={() =>
                    setSelectedBonds((current) =>
                      current.includes(bond.id)
                        ? current.filter((id) => id !== bond.id)
                        : [...current, bond.id],
                    )
                  }
                >
                  <b>{bond.label}</b>
                  <span className="dim">
                    {bond.hunterName} × {bond.constellationName}
                  </span>
                </button>
              ))}
            </div>
          )}

          <h3 className="sub-title">배치 적 ({selectedEnemies.length})</h3>
          {templates.length === 0 ? (
            <p className="dim">
              등록된 적이 없습니다. <b>적 세팅</b> 탭에서 먼저 만드세요.
            </p>
          ) : (
            <div className="pick-grid">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={`pick-card ${selectedEnemies.includes(template.id) ? 'on' : ''} ${
                    template.boss ? 'boss' : ''
                  }`}
                  onClick={() =>
                    setSelectedEnemies((current) =>
                      current.includes(template.id)
                        ? current.filter((id) => id !== template.id)
                        : [...current, template.id],
                    )
                  }
                >
                  <b>{template.name}</b>
                  <span className="dim">
                    HP {template.maxHp} · ATK {template.attack} · DEF {template.defense}
                  </span>
                </button>
              ))}
            </div>
          )}

          <h3 className="sub-title">층 설정</h3>
          <div className="admin-grid">
            <NumberField label="층" value={floor} min={1} onCommit={setFloor} />
            <label className="num-field">
              <span className="field-label">기믹</span>
              <select
                className="ctl input"
                value={gimmickId}
                onChange={(event) => setGimmickId(event.target.value)}
              >
                <option value="">없음 (장치 없는 전투)</option>
                {GIMMICK_DEFINITIONS.map((def) => (
                  <option key={def.id} value={def.id}>
                    {def.labelKo} · {def.required}회 / {def.roundLimit ?? '∞'}R
                  </option>
                ))}
              </select>
              <small className="hint">
                {gimmickId
                  ? '헌터의 기믹 수행으로 파악 → 해결 순으로 풉니다.'
                  : '기믹 수행 행동이 잠깁니다. 보스 패턴만으로 진행하는 전투가 됩니다.'}
              </small>
            </label>
          </div>

          {/* 기믹이 있어야 성립하는 보스를 장치 없이 세우면 그대로 학살이 된다 */}
          {gimmickWarning && <p className="notice warn">{gimmickWarning}</p>}

          {/* 같은 조합을 매번 다시 고르지 않게 한다. 이 브라우저에만 남는다. */}
          <h3 className="sub-title">프리셋</h3>
          <div className="preset-bar">
            <button
              type="button"
              className="ctl small"
              disabled={selectedBonds.length === 0 && selectedEnemies.length === 0}
              onClick={capturePreset}
            >
              지금 구성 저장
            </button>
            {presets.length === 0 ? (
              <span className="dim small-text">저장된 프리셋이 없습니다.</span>
            ) : (
              presets.map((preset) => (
                <span key={preset.id} className="preset-chip">
                  <button type="button" className="ctl small" onClick={() => usePreset(preset)}>
                    {preset.name}
                  </button>
                  <button
                    type="button"
                    className="ctl small"
                    title="이 프리셋을 지웁니다"
                    onClick={() =>
                      savePresets(presets.filter((row) => row.id !== preset.id))
                    }
                  >
                    ✕
                  </button>
                </span>
              ))
            )}
          </div>

          <button
            type="button"
            className="confirm-btn"
            disabled={busy || selectedBonds.length === 0 || selectedEnemies.length === 0}
            onClick={() => void startOperation()}
          >
            {busy ? '전투를 만드는 중…' : '전투 시작'}
            <small>
              {selectedBonds.length}페어 · 적 {selectedEnemies.length}체 · FLOOR {floor}
            </small>
          </button>

          {battles.length > 0 && (
            <Collapsible label={`지난 전투 ${battles.length}`} defaultOpen={battles.length <= 3}>
              <table className="preview-table">
                <thead>
                  <tr>
                    <th>작전</th>
                    <th>규모</th>
                    <th>라운드</th>
                    <th>상태</th>
                    <th>마지막 갱신</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {battles.map((row) => (
                    <tr key={row.id}>
                      <td>{row.operationName || '이름 없는 작전'}</td>
                      <td className="dim small-text">
                        {row.mode === 'RAID' ? '레이드' : '단독'}
                      </td>
                      <td className="num">R{row.round}</td>
                      <td>
                        <span
                          className={`tag ${
                            row.status === 'ENGAGED'
                              ? 'ok'
                              : row.status === 'CLEARED'
                                ? 'blue'
                                : row.status === 'FAILED'
                                  ? 'critical'
                                  : 'warn'
                          }`}
                        >
                          {row.status === 'ENGAGED'
                            ? '진행 중'
                            : row.status === 'CLEARED'
                              ? '클리어'
                              : row.status === 'FAILED'
                                ? '실패'
                                : '준비'}
                        </span>
                      </td>
                      <td className="dim small-text num">{shortTime(row.updatedAt)}</td>
                      <td>
                        <div className="btn-row">
                          <button
                            type="button"
                            className="ctl small"
                            onClick={async () => {
                              const loaded = await storage.loadBattle(row.id);
                              if (loaded) {
                                autoOpened.current = true;
                                update(loaded);
                              } else setMessage('불러올 수 없습니다 (스키마 버전 불일치).');
                            }}
                          >
                            열기
                          </button>
                          <button
                            type="button"
                            className="ctl small"
                            title="이 전투 기록을 지웁니다"
                            onClick={() => {
                              if (
                                !confirmed(
                                  `${row.operationName || '이 전투'} 기록을 삭제합니다. 로그와 제출까지 함께 지워지고 되돌릴 수 없습니다.`,
                                )
                              ) {
                                return;
                              }
                              void guard(async () => {
                                await storage.deleteBattle(row.id);
                                await refresh();
                                setMessage('전투 기록을 삭제했습니다.');
                              });
                            }}
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Collapsible>
          )}

          <div className="btn-row" style={{ marginTop: 14 }}>
            <button type="button" className="ctl small" onClick={() => void exportJson()}>
              EXPORT JSON
            </button>
            <button type="button" className="ctl small" onClick={() => fileInput.current?.click()}>
              IMPORT JSON
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importJson(file);
                event.target.value = '';
              }}
            />
          </div>
        </section>
      )}

      {tab === 'OPERATION' && battle && (
        <>
          {/* 전투 제어 */}
          <section className="panel session">
            <div className="session-row">
              <span className={`tag ${battle.status === 'ENGAGED' ? 'ok' : 'warn'}`}>
                {battle.status}
              </span>
              <NumberField
                label="ROUND"
                value={battle.round}
                min={1}
                onCommit={(value) => update(admin.setRound(battle, value))}
              />
              <div className="btn-row">
                <button
                  type="button"
                  className="ctl small"
                  onClick={() => {
                    if (confirmed('이 전투를 클리어로 종료합니다. 참가자는 더 이상 제출할 수 없습니다.')) {
                      update(admin.setBattleStatus(battle, 'CLEARED'));
                    }
                  }}
                >
                  종료 · 클리어
                </button>
                <button
                  type="button"
                  className="ctl small"
                  onClick={() => {
                    if (confirmed('이 전투를 실패로 종료합니다. 참가자는 더 이상 제출할 수 없습니다.')) {
                      update(admin.setBattleStatus(battle, 'FAILED'));
                    }
                  }}
                >
                  종료 · 실패
                </button>
                <button
                  type="button"
                  className="ctl small"
                  title="모든 페어의 이번 라운드 제출을 지웁니다"
                  onClick={() => {
                    if (confirmed('모든 페어의 이번 라운드 제출을 지웁니다. 참가자가 다시 골라야 합니다.')) {
                      update(admin.resetAllSubmissions(battle));
                    }
                  }}
                >
                  제출 초기화
                </button>
                <button
                  type="button"
                  className="ctl small"
                  title="전투는 서버에 남습니다. 이 화면에서만 닫습니다."
                  onClick={() => {
                    autoOpened.current = true;
                    setBattle(null);
                    setPreview(null);
                    void refresh();
                  }}
                >
                  전투 닫기
                </button>
              </div>
            </div>
          </section>

          {/* 이탈자 */}
          {waitingSides.length > 0 && (
            <section className="panel desertion">
              <div className="process-head">
                <h2 className="panel-title">미제출 · {waitingSides.length}</h2>
                <div className="btn-row">
                  <button type="button" className="ctl small" onClick={callWaiting}>
                    채널로 호출
                  </button>
                  <button
                    type="button"
                    className="ctl primary"
                    onClick={() => update(admin.forceAutoForUnsubmitted(battle))}
                  >
                    전원 자동 위임
                  </button>
                </div>
              </div>
              <div className="desertion-list">
                {waitingSides.map((row) => (
                  <div className="desertion-row" key={`${row.pairId}-${row.side}`}>
                    <b>{row.label}</b>
                    <span className={`tag ${row.side === 'HUNTER' ? 'blue' : 'gold'}`}>
                      {row.side === 'HUNTER' ? '헌터' : '성좌'}
                    </span>
                    <button
                      type="button"
                      className="ctl small"
                      onClick={() => update(admin.forceControl(battle, row.pairId, row.side, 'AUTO'))}
                    >
                      강제 AUTO
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 적 상황판 */}
          <section className="panel">
            <h2 className="panel-title">TARGET STATUS</h2>
            <div className="target-grid">
              {battle.enemies.map((enemy) => (
                <article key={enemy.id} className={`target ${enemy.boss ? 'boss' : ''}`}>
                  <div className="target-head">
                    <span className="grade">{enemy.grade}</span>
                    <b>{enemy.name}</b>
                  </div>
                  <Bar
                    value={enemy.hp}
                    max={enemy.maxHp}
                    tone={enemy.hp / enemy.maxHp < 0.3 ? 'critical' : 'danger'}
                  />
                  <div className="stat-strip">
                    <span>
                      <i>HP</i>
                      <b className="num">
                        {enemy.hp}
                        <small>/{enemy.maxHp}</small>
                      </b>
                    </span>
                    <span>
                      <i>ATK</i>
                      <b className="num">{enemy.attack}</b>
                    </span>
                    <span>
                      <i>DEF</i>
                      <b className="num">{enemy.defense}</b>
                    </span>
                    <span>
                      <i>PHASE</i>
                      <b className="num">
                        {enemy.phase}
                        <small>/{enemy.maxPhase}</small>
                      </b>
                    </span>
                  </div>
                  <StatusEditor
                    holder="ENEMY"
                    ownerId={enemy.id}
                    statuses={enemy.statuses}
                    onGrant={(h, o, d) => update(admin.grantStatus(battle, h, o, d))}
                    onRevoke={(h, o, d) => update(admin.revokeStatus(battle, h, o, d))}
                  />
                  {/* 접지 않고 바로 깎는다 — 전투 중 가장 자주 하는 조작이다 */}
                  <div className="quick-hp">
                    <span className="field-label">HP</span>
                    {[-20, -10, -5, 5, 10].map((delta) => (
                      <button
                        key={delta}
                        type="button"
                        className="ctl small"
                        onClick={() =>
                          update(admin.setEnemyHp(battle, enemy.id, enemy.hp + delta))
                        }
                      >
                        {delta > 0 ? `+${delta}` : delta}
                      </button>
                    ))}
                    <NumberField
                      label=""
                      value={enemy.hp}
                      max={enemy.maxHp}
                      onCommit={(value) => update(admin.setEnemyHp(battle, enemy.id, value))}
                    />
                    <button
                      type="button"
                      className="ctl small"
                      title="이 적을 쓰러뜨립니다"
                      onClick={() => update(admin.setEnemyHp(battle, enemy.id, 0))}
                    >
                      처치
                    </button>
                  </div>

                  <div className="admin-only">
                    <span className="field-label">운영진 전용 · 다음 패턴</span>
                    <b className="gold">{nextPatternAdmin(enemy, battle.round)}</b>
                    {enemy.telegraph && (
                      <>
                        <span className="tag critical">
                          예고 {Math.max(0, enemy.telegraph.roundsLeft)}R
                        </span>
                        <button
                          type="button"
                          className="ctl small"
                          onClick={() => update(admin.clearTelegraph(battle, enemy.id))}
                        >
                          취소
                        </button>
                      </>
                    )}
                  </div>
                  <Collapsible
                    label={`보스 패턴 — 공격 ${(enemy.attacks ?? []).length}개 · ${describePhaseBands(
                      enemy,
                    )}`}
                  >
                    <AttackEditor
                      attacks={enemy.attacks ?? []}
                      maxPhase={enemy.maxPhase}
                      enemyAttack={enemy.attack}
                      maxHp={enemy.maxHp}
                      phaseCutoffs={enemy.phaseCutoffs ?? []}
                      patternSetId={enemy.patternSetId}
                      onChange={(attacks) =>
                        update(admin.setEnemyAttacks(battle, enemy.id, attacks))
                      }
                      onPhaseCutoffs={(phaseCutoffs) =>
                        update(admin.setEnemyPhaseRules(battle, enemy.id, { phaseCutoffs }))
                      }
                    />
                  </Collapsible>

                  <Collapsible label="수치 편집">
                    <div className="admin-grid">
                      <NumberField
                        label="HP"
                        value={enemy.hp}
                        max={enemy.maxHp}
                        onCommit={(value) => update(admin.setEnemyHp(battle, enemy.id, value))}
                      />
                      <NumberField
                        label="MAX HP"
                        value={enemy.maxHp}
                        min={1}
                        onCommit={(value) =>
                          update(admin.setEnemyStats(battle, enemy.id, { maxHp: value }))
                        }
                      />
                      <NumberField
                        label="ATK"
                        value={enemy.attack}
                        onCommit={(value) =>
                          update(admin.setEnemyStats(battle, enemy.id, { attack: value }))
                        }
                      />
                      <NumberField
                        label="DEF"
                        value={enemy.defense}
                        onCommit={(value) =>
                          update(admin.setEnemyStats(battle, enemy.id, { defense: value }))
                        }
                      />
                      <NumberField
                        label="PHASE"
                        value={enemy.phase}
                        min={1}
                        max={enemy.maxPhase}
                        onCommit={(value) => update(admin.setEnemyPhase(battle, enemy.id, value))}
                      />
                      <NumberField
                        label="MAX PHASE"
                        value={enemy.maxPhase}
                        min={1}
                        max={5}
                        onCommit={(value) =>
                          update(admin.setEnemyPhaseRules(battle, enemy.id, { maxPhase: value }))
                        }
                      />
                    </div>
                  </Collapsible>
                </article>
              ))}
            </div>

            {battle.gimmick && (
              <div className="admin-gimmick">
                <span className="field-label">기믹</span>
                <b>{battle.gimmick.labelKo}</b>
                <span className="num">
                  {battle.gimmick.progress} / {battle.gimmick.required}
                </span>
                <span
                  className={`tag ${
                    battle.gimmick.status === 'CLEARED'
                      ? 'ok'
                      : battle.gimmick.status === 'FAILED'
                        ? 'critical'
                        : 'warn'
                  }`}
                >
                  {battle.gimmick.status}
                </span>
                <span className="num dim">
                  {battle.gimmick.roundsLeft === null ? '제한 없음' : `${battle.gimmick.roundsLeft}R 남음`}
                </span>
                <NumberField
                  label="진행"
                  value={battle.gimmick.progress}
                  onCommit={(value) => update(admin.setGimmickProgress(battle, value))}
                />
                <select
                  className="ctl"
                  value={battle.gimmick.status}
                  onChange={(event) =>
                    update(admin.setGimmickStatus(battle, event.target.value as 'ACTIVE'))
                  }
                >
                  <option value="ACTIVE">진행 중</option>
                  <option value="CLEARED">해제</option>
                  <option value="FAILED">실패</option>
                </select>
              </div>
            )}

            {/* 무엇을 해야 풀리는 장치인지 — 판정을 인정할 때 기준이 된다 */}
            {battle.gimmick && (findGimmick(battle.gimmick.defId)?.approaches.length ?? 0) > 0 && (
              <Collapsible label="인정되는 접근 (판정 기준)">
                <table className="preview-table">
                  <thead>
                    <tr>
                      <th>단계</th>
                      <th>접근</th>
                      <th>보정</th>
                      <th>인정 낱말</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(findGimmick(battle.gimmick.defId)?.approaches ?? []).map((row) => (
                      <tr key={row.id}>
                        <td>
                          <span className={`tag ${row.stage === 'INSIGHT' ? 'blue' : 'gold'}`}>
                            {row.stage === 'INSIGHT' ? '파악' : '해결'}
                          </span>
                        </td>
                        <td>
                          {row.label}
                          <small className="dim">{row.detail}</small>
                        </td>
                        <td className="num">+{row.bonus}</td>
                        <td className="dim small-text">{row.keywords.join(' · ')}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={3} className="dim small-text">
                        어느 접근에도 걸리지 않은 선언
                      </td>
                      <td className="num warn-text">{GIMMICK_CHECK.offApproachPenalty}</td>
                    </tr>
                  </tbody>
                </table>
              </Collapsible>
            )}
          </section>

          {/* 페어 모니터 */}
          <section className="panel">
            <div className="process-head">
              <h2 className="panel-title">PAIR MONITOR</h2>
              <div className="btn-row">
                {(
                  [
                    ['ALL', '전체'],
                    ['GOVERNMENT', '정부'],
                    ['GUILD', '길드'],
                    ['INJURED', `부상 ${injured}`],
                    ['DOWN', `전투불능 ${down}`],
                    ['NOT_SUBMITTED', `미제출 ${waitingSides.length}`],
                  ] as Array<[PairFilter, string]>
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`ctl small ${filter === value ? 'on' : ''}`}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  className={`ctl small ${monitorDense ? '' : 'on'}`}
                  title="편집 도구까지 펼쳐 봅니다"
                  onClick={() => setMonitorDense((current) => !current)}
                >
                  {monitorDense ? '간략' : '상세'}
                </button>
              </div>
            </div>

            {/* 일괄 조작 — 페어를 하나씩 열어 같은 값을 넣는 일을 없앤다 */}
            <div className="bulk-bar">
              <button
                type="button"
                className="ctl small"
                onClick={() =>
                  setBulkPairs((current) =>
                    current.length === filteredPairs.length
                      ? []
                      : filteredPairs.map((row) => row.id),
                  )
                }
              >
                {bulkPairs.length === filteredPairs.length && filteredPairs.length > 0
                  ? '선택 해제'
                  : `보이는 ${filteredPairs.length}개 선택`}
              </button>
              <span className="field-label">선택 {bulkPairs.length}</span>
              <div className="btn-row">
                <button
                  type="button"
                  className="ctl small"
                  disabled={bulkPairs.length === 0}
                  onClick={() =>
                    runBulk('HP 완전 회복', (state, pairId) => {
                      const pair = state.pairs.find((row) => row.id === pairId);
                      return pair ? admin.setHunterHp(state, pairId, pair.hunter.maxHp) : state;
                    })
                  }
                >
                  HP 완전 회복
                </button>
                <button
                  type="button"
                  className="ctl small"
                  disabled={bulkPairs.length === 0}
                  onClick={() =>
                    runBulk('HP 절반 회복', (state, pairId) => {
                      const pair = state.pairs.find((row) => row.id === pairId);
                      if (!pair) return state;
                      const half = Math.ceil(pair.hunter.maxHp / 2);
                      return admin.setHunterHp(state, pairId, Math.max(pair.hunter.hp, half));
                    })
                  }
                >
                  HP 절반까지
                </button>
                <button
                  type="button"
                  className="ctl small"
                  disabled={bulkPairs.length === 0}
                  onClick={() =>
                    runBulk('행동력 충전', (state, pairId) => {
                      const pair = state.pairs.find((row) => row.id === pairId);
                      if (!pair) return state;
                      return admin.setActorAp(
                        admin.setActorAp(state, pairId, 'HUNTER', pair.hunter.maxAp),
                        pairId,
                        'CONSTELLATION',
                        pair.constellation.maxAp,
                      );
                    })
                  }
                >
                  AP 충전
                </button>
                <button
                  type="button"
                  className="ctl small"
                  disabled={bulkPairs.length === 0}
                  onClick={() => runBulk('상태이상 해제', clearStatuses)}
                >
                  상태이상 해제
                </button>
                <button
                  type="button"
                  className="ctl small"
                  disabled={bulkPairs.length === 0}
                  onClick={() => runBulk('제출 초기화', admin.resetSubmission)}
                >
                  제출 초기화
                </button>
                <select
                  className="ctl small"
                  value=""
                  disabled={bulkPairs.length === 0}
                  onChange={(event) => {
                    const reason = event.target.value;
                    if (!reason) return;
                    const rule = manualRewards().find((row) => row.reason === reason);
                    runBulk(`${rule?.labelKo ?? reason} 지급`, (state, pairId) =>
                      admin.grantPoints(
                        state,
                        pairId,
                        reason as Parameters<typeof admin.grantPoints>[2],
                      ),
                    );
                    event.target.value = '';
                  }}
                >
                  <option value="">포인트 일괄 지급…</option>
                  {manualRewards().map((rule) => (
                    <option key={rule.reason} value={rule.reason}>
                      {rule.labelKo} · {rule.points}P
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="monitor-grid">
              {filteredPairs.map((pair) => {
                const injury = injuryOf(pair.hunter);
                const ready = pairReady(pair);

                return (
                  <article
                    key={pair.id}
                    className={`monitor-card ${ready ? 'ready' : ''} ${
                      bulkPairs.includes(pair.id) ? 'picked' : ''
                    }`}
                  >
                    <header className="monitor-head">
                      <div>
                        <input
                          type="checkbox"
                          className="bulk-check"
                          title="일괄 조작 대상"
                          checked={bulkPairs.includes(pair.id)}
                          onChange={() =>
                            setBulkPairs((current) =>
                              current.includes(pair.id)
                                ? current.filter((id) => id !== pair.id)
                                : [...current, pair.id],
                            )
                          }
                        />
                        <b>{pair.label}</b>
                        <span className={`tag ${pair.affiliation === 'GOVERNMENT' ? 'blue' : 'gold'}`}>
                          {pair.affiliation === 'GOVERNMENT' ? '정부' : '길드'}
                        </span>
                      </div>
                      <span
                        className={`tag ${
                          pair.hunter.hp <= 0 ? 'offline' : ready ? 'ok' : 'warn'
                        }`}
                      >
                        {pair.hunter.hp <= 0 ? '전투 불능' : ready ? '준비 완료' : '대기'}
                      </span>
                    </header>

                    {/* 쪽별 제출 상태 — 운영 판단의 핵심 */}
                    <div className="monitor-submission">
                      {(['HUNTER', 'CONSTELLATION'] as ActorSide[]).map((side) => {
                        const actor = side === 'HUNTER' ? pair.hunter : pair.constellation;
                        const submitted =
                          side === 'HUNTER'
                            ? pair.submission.hunterSubmitted
                            : pair.submission.constellationSubmitted;
                        const actionId =
                          side === 'HUNTER'
                            ? pair.submission.hunterActionId
                            : pair.submission.constellationActionId;

                        return (
                          <div className="submission-row" key={side}>
                            <span className={`tag ${side === 'HUNTER' ? 'blue' : 'gold'}`}>
                              {side === 'HUNTER' ? '헌터' : '성좌'}
                            </span>
                            <b>{actor.name}</b>
                            <span className="dim small-text">{actionId ?? '미선택'}</span>
                            <span className={`tag ${submitted ? 'ok' : 'warn'}`}>
                              {submitted ? '제출' : '대기'}
                            </span>
                            <button
                              type="button"
                              className={`ctl small ${actor.control === 'AUTO' ? 'on' : ''}`}
                              onClick={() =>
                                update(
                                  admin.forceControl(
                                    battle,
                                    pair.id,
                                    side,
                                    actor.control === 'AUTO' ? 'ACTIVE' : 'AUTO',
                                  ),
                                )
                              }
                            >
                              {actor.control === 'AUTO' ? 'AUTO 해제' : '강제 AUTO'}
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    <Bar value={pair.hunter.hp} max={pair.hunter.maxHp} tone={injury.tone} />
                    <div className="stat-strip">
                      <span>
                        <i>HP</i>
                        <b className="num">
                          {pair.hunter.hp}
                          <small>/{pair.hunter.maxHp}</small>
                        </b>
                      </span>
                      <span>
                        <i>헌터 AP</i>
                        <b className="num">
                          {pair.hunter.ap}
                          <small>/{pair.hunter.maxAp}</small>
                        </b>
                      </span>
                      <span>
                        <i>성좌 AP</i>
                        <b className="num">
                          {pair.constellation.ap}
                          <small>/{pair.constellation.maxAp}</small>
                        </b>
                      </span>
                      <span>
                        <i>권능</i>
                        <b className="num gold">×{pair.constellation.power}</b>
                      </span>
                      <span>
                        <i>P</i>
                        <b className="num gold">{pair.points}</b>
                      </span>
                    </div>

                    {monitorDense ? (
                      <div className="monitor-status">
                        <span className="field-label">상태</span>
                        {[
                          ...statusViews(pair.hunter.statuses),
                          ...statusViews(pair.constellation.statuses),
                        ].length === 0 ? (
                          <span className="dim small-text">없음</span>
                        ) : (
                          [
                            ...statusViews(pair.hunter.statuses),
                            ...statusViews(pair.constellation.statuses),
                          ].map((view, index) => (
                            <span key={`${view.label}-${index}`} className="tag">
                              {view.label}
                            </span>
                          ))
                        )}
                      </div>
                    ) : (
                    <div className="monitor-status">
                      <span className="field-label">헌터</span>
                      <StatusEditor
                        holder="HUNTER"
                        ownerId={pair.id}
                        statuses={pair.hunter.statuses}
                        onGrant={(h, o, d) => update(admin.grantStatus(battle, h, o, d))}
                        onRevoke={(h, o, d) => update(admin.revokeStatus(battle, h, o, d))}
                      />
                      <span className="field-label">성좌</span>
                      <StatusEditor
                        holder="CONSTELLATION"
                        ownerId={pair.id}
                        statuses={pair.constellation.statuses}
                        onGrant={(h, o, d) => update(admin.grantStatus(battle, h, o, d))}
                        onRevoke={(h, o, d) => update(admin.revokeStatus(battle, h, o, d))}
                      />
                    </div>
                    )}

                    {/* 참가자가 지금 무엇을 보고 있는지 — 안내를 하려면 같은 것을 봐야 한다 */}
                    <Collapsible label="참가자 시점">
                      <div className="viewer-peek">
                        <div>
                          <span className="field-label">장치</span>
                          {battle.gimmick ? (
                            <>
                              <span className={`tag ${battle.gimmick.identified ? 'ok' : 'warn'}`}>
                                {battle.gimmick.identified ? '파악 완료' : '미파악'}
                              </span>
                              {availableStage(battle.gimmick, pair) && (
                                <span className="tag blue">
                                  다음 단계 ·{' '}
                                  {availableStage(battle.gimmick, pair) === 'INSIGHT'
                                    ? '파악'
                                    : '해결'}
                                </span>
                              )}
                              <span className="dim small-text">
                                {gimmickBrief(battle.gimmick).text}
                              </span>
                            </>
                          ) : (
                            <span className="dim small-text">
                              이 층에는 장치가 없습니다 — 기믹 수행이 잠겨 있습니다.
                            </span>
                          )}
                        </div>
                        <div>
                          <span className="field-label">다음 패턴</span>
                          <span className={pair.patternRevealed ? 'gold' : 'dim'}>
                            {pair.patternRevealed
                              ? (peekTarget(pair)?.nextPattern ?? '없음')
                              : 'UNKNOWN (계시 없음)'}
                          </span>
                        </div>
                        {(['HUNTER', 'CONSTELLATION'] as ActorSide[]).map((side) => {
                          const blocked = actionsFor(pair, side)
                            .map((action) => ({
                              action,
                              availability: actionAvailability(
                                action,
                                pair,
                                Boolean(peekTarget(pair)),
                                battle.gimmick,
                              ),
                            }))
                            .filter((row) => !row.availability.usable);

                          return (
                            <div key={side}>
                              <span className="field-label">
                                {side === 'HUNTER' ? '헌터' : '성좌'} 잠긴 행동
                              </span>
                              {blocked.length === 0 ? (
                                <span className="dim small-text">없음 — 전부 고를 수 있습니다</span>
                              ) : (
                                blocked.map((row) => (
                                  <span key={row.action.id} className="tag warn">
                                    {row.action.labelKo} · {row.availability.reason}
                                  </span>
                                ))
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </Collapsible>

                    {/* 판정 근거 — 스탯과 스킬을 모르면 기믹도 연출도 판정할 수 없다 */}
                    {!monitorDense && (
                    <Collapsible label="시트 · 스킬 (판정 참고)">
                      <div className="sheet-list">
                        <ActorSheet
                          side="HUNTER"
                          name={pair.hunter.name}
                          classId={pair.hunter.classId}
                          stats={pair.hunter.stats}
                          skills={pair.hunter.skills}
                          accountId={pair.hunterAccountId}
                          profile={sheetOf(pair.hunterAccountId)}
                          portrait={sheetOf(pair.hunterAccountId)?.portrait}
                        />
                        <ActorSheet
                          side="CONSTELLATION"
                          name={pair.constellation.name}
                          classId={pair.constellation.classId}
                          stats={pair.constellation.stats}
                          skills={pair.constellation.skills}
                          accountId={pair.constellationAccountId}
                          profile={sheetOf(pair.constellationAccountId)}
                          portrait={sheetOf(pair.constellationAccountId)?.portrait}
                        />
                      </div>
                    </Collapsible>
                    )}

                    {!monitorDense && (
                    <Collapsible label="수치 편집">
                      <div className="admin-grid">
                        <NumberField
                          label="HP"
                          value={pair.hunter.hp}
                          max={pair.hunter.maxHp}
                          onCommit={(value) => update(admin.setHunterHp(battle, pair.id, value))}
                        />
                        <NumberField
                          label="MAX HP"
                          value={pair.hunter.maxHp}
                          min={1}
                          onCommit={(value) => update(admin.setHunterMaxHp(battle, pair.id, value))}
                        />
                        <NumberField
                          label="헌터 AP"
                          value={pair.hunter.ap}
                          onCommit={(value) =>
                            update(admin.setActorAp(battle, pair.id, 'HUNTER', value))
                          }
                        />
                        <NumberField
                          label="성좌 AP"
                          value={pair.constellation.ap}
                          onCommit={(value) =>
                            update(admin.setActorAp(battle, pair.id, 'CONSTELLATION', value))
                          }
                        />
                        <NumberField
                          label="공격력"
                          value={pair.hunter.attack}
                          onCommit={(value) =>
                            update(admin.setHunterStats(battle, pair.id, { attack: value }))
                          }
                        />
                        <NumberField
                          label="방어력"
                          value={pair.hunter.defense}
                          onCommit={(value) =>
                            update(admin.setHunterStats(battle, pair.id, { defense: value }))
                          }
                        />
                        <NumberField
                          label="권능 배율"
                          value={pair.constellation.power}
                          step={0.01}
                          onCommit={(value) =>
                            update(admin.setConstellationPower(battle, pair.id, value))
                          }
                        />
                        <NumberField
                          label="포인트"
                          value={pair.points}
                          step={10}
                          onCommit={(value) => update(admin.setPairPoints(battle, pair.id, value))}
                        />
                        <label className="num-field">
                          <span className="field-label">성좌 상태</span>
                          <select
                            className="ctl input"
                            value={pair.constellation.stage}
                            onChange={(event) =>
                              update(
                                admin.setConstellationStage(
                                  battle,
                                  pair.id,
                                  event.target.value as ConstellationStage,
                                ),
                              )
                            }
                          >
                            {Object.entries(CONSTELLATION_STAGES).map(([key, def]) => (
                              <option key={key} value={key}>
                                {def.labelKo}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="num-field">
                          <span className="field-label">계약 단계</span>
                          <select
                            className="ctl input"
                            value={pair.contract.stage}
                            onChange={(event) =>
                              update(
                                admin.setContract(battle, pair.id, {
                                  stage: event.target.value as ContractStage,
                                }),
                              )
                            }
                          >
                            {Object.entries(CONTRACT_STAGES).map(([key, def]) => (
                              <option key={key} value={key}>
                                {def.labelKo}
                              </option>
                            ))}
                          </select>
                        </label>
                        <NumberField
                          label="부분 현신"
                          value={pair.constellation.manifestUses.partial ?? 0}
                          onCommit={(value) =>
                            update(admin.setManifestUses(battle, pair.id, { partial: value }))
                          }
                        />
                        <NumberField
                          label="완전 현신"
                          value={pair.constellation.manifestUses.full ?? 0}
                          onCommit={(value) =>
                            update(admin.setManifestUses(battle, pair.id, { full: value }))
                          }
                        />
                      </div>

                      <h4 className="sub-title">아이템 지급 · 회수</h4>
                      <div className="item-admin">
                        {pair.inventory.length === 0 ? (
                          <p className="dim small-text">가방이 비어 있습니다.</p>
                        ) : (
                          <ul className="inventory-list">
                            {pair.inventory.map((stack) => {
                              const item = findItem(stack.itemId);
                              if (!item) return null;
                              return (
                                <li key={stack.itemId}>
                                  <span>{item.nameKo}</span>
                                  <b className="num gold">{stack.quantity}</b>
                                  <button
                                    type="button"
                                    className="ctl small"
                                    onClick={() =>
                                      update(admin.grantItem(battle, pair.id, stack.itemId, 1))
                                    }
                                  >
                                    +1
                                  </button>
                                  <button
                                    type="button"
                                    className="ctl small"
                                    onClick={() =>
                                      update(admin.revokeItem(battle, pair.id, stack.itemId, 1))
                                    }
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
                          onChange={(event) => {
                            if (!event.target.value) return;
                            update(admin.grantItem(battle, pair.id, event.target.value, 1));
                          }}
                        >
                          <option value="">아이템 지급…</option>
                          {ITEM_DEFINITIONS.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.nameKo} · {describeItem(item).join(' / ') || '효과 없음'}
                            </option>
                          ))}
                        </select>
                      </div>

                      <h4 className="sub-title">포인트 지급</h4>
                      <div className="item-admin">
                        <select
                          className="ctl input"
                          value=""
                          onChange={(event) => {
                            const reason = event.target.value;
                            if (!reason) return;
                            update(
                              admin.grantPoints(
                                battle,
                                pair.id,
                                reason as Parameters<typeof admin.grantPoints>[2],
                              ),
                            );
                          }}
                        >
                          <option value="">수동 지급 사유…</option>
                          {manualRewards().map((rule) => (
                            <option key={rule.reason} value={rule.reason}>
                              {rule.labelKo} · {rule.points}P
                              {rule.range ? ` (${rule.range.min}~${rule.range.max})` : ''}
                            </option>
                          ))}
                        </select>
                        {battle.rewards.filter((row) => row.pairId === pair.id).length > 0 && (
                          <ul className="inventory-list">
                            {battle.rewards
                              .filter((row) => row.pairId === pair.id)
                              .map((row) => (
                                <li key={row.id}>
                                  <span>R{row.round}</span>
                                  <span>{row.label}</span>
                                  <b className="num gold">+{row.points}</b>
                                  <button
                                    type="button"
                                    className="ctl small"
                                    title="지급을 취소하고 포인트를 되돌립니다"
                                    onClick={() => update(admin.revokeReward(battle, row.id))}
                                  >
                                    ✕
                                  </button>
                                </li>
                              ))}
                          </ul>
                        )}
                      </div>
                    </Collapsible>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          {/* 라운드 처리 */}
          <section className="panel process" ref={processRef}>
            <div className="process-head">
              <h2 className="panel-title">ROUND {String(battle.round).padStart(2, '0')} 처리</h2>
              <div className="btn-row">
                {undoBattle && (
                  <button
                    type="button"
                    className="ctl small"
                    title={`ROUND ${undoBattle.round} 확정 직전으로 되돌립니다`}
                    onClick={undoApply}
                  >
                    ↩ ROUND {undoBattle.round} 되돌리기
                  </button>
                )}
              </div>
            </div>
            <p className="hint">
              APPLY 전에 피해량과 연계를 직접 수정할 수 있습니다. 자동 계산은 제안일 뿐입니다.
            </p>

            {!preview ? (
              <button
                type="button"
                className="ctl wide"
                disabled={battle.status !== 'ENGAGED'}
                onClick={computeRound}
              >
                라운드 계산
                {waitingSides.length > 0 && (
                  <small>미제출 {waitingSides.length}건은 자동 행동으로 채워집니다</small>
                )}
              </button>
            ) : (
              <div className="preview">
                <table className="preview-table editable">
                  <thead>
                    <tr>
                      <th>페어</th>
                      <th>헌터</th>
                      <th>성좌</th>
                      <th>연계</th>
                      <th>피해</th>
                      <th>비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.pairs.map((row) => (
                      <tr key={row.pairId}>
                        <td>{row.pairLabel}</td>
                        <td>
                          {row.hunterActionLabel}
                          {row.autoFilled.includes('HUNTER') && (
                            <span className="tag auto">AUTO</span>
                          )}
                        </td>
                        <td>
                          {row.constellationActionLabel}
                          {row.autoFilled.includes('CONSTELLATION') && (
                            <span className="tag auto">AUTO</span>
                          )}
                        </td>
                        <td>
                          {row.combo ? (
                            <button
                              type="button"
                              className="tag ok removable"
                              title="클릭하면 연계 취소"
                              onClick={() => patchPreviewPair(row.pairId, { combo: null })}
                            >
                              {row.combo.label} ✕
                            </button>
                          ) : (
                            <span className="dim">—</span>
                          )}
                        </td>
                        <td>
                          <input
                            className="ctl input tiny"
                            type="number"
                            value={row.damageToEnemy}
                            onChange={(event) =>
                              patchPreviewPair(row.pairId, {
                                damageToEnemy: Math.max(0, Number(event.target.value) || 0),
                              })
                            }
                          />
                        </td>
                        <td className="dim small-text">
                          {row.gimmickNote && (
                            <div className="judge-box">
                              <span className={`tag ${row.gimmickCheck?.stage === 'INSIGHT' ? 'blue' : 'gold'}`}>
                                {row.gimmickCheck?.stage === 'INSIGHT' ? '파악' : '해결'}
                              </span>
                              <span className="judge-note">{row.gimmickNote}</span>
                              {row.gimmickCheck && (
                                <span
                                  className={`tag ${row.gimmickCheck.approachLabel ? 'ok' : 'warn'}`}
                                  title="선언이 인정되는 접근에 걸렸는지"
                                >
                                  {row.gimmickCheck.approachLabel ?? '접근 불인정'}
                                </span>
                              )}
                              {row.gimmickCheck && (
                                <span
                                  className={`tag ${row.gimmickCheck.success ? 'ok' : 'critical'}`}
                                  title={row.gimmickCheck.breakdown.join(' / ')}
                                >
                                  {row.gimmickCheck.rolls.join('+')}+{row.gimmickCheck.bonus}={' '}
                                  {row.gimmickCheck.total} vs {row.gimmickCheck.dc}
                                </span>
                              )}
                              {row.gimmickCheck?.stage === 'RESOLVE' && (
                                <label className="judge-progress">
                                  <span className="field-label">진행</span>
                                  <input
                                    className="ctl input tiny"
                                    type="number"
                                    value={row.gimmickProgress}
                                    onChange={(event) =>
                                      patchPreviewPair(row.pairId, {
                                        gimmickProgress: Math.max(
                                          0,
                                          Number(event.target.value) || 0,
                                        ),
                                      })
                                    }
                                  />
                                </label>
                              )}
                              {row.gimmickCheck?.stage === 'INSIGHT' && (
                                <button
                                  type="button"
                                  className={`ctl small ${row.gimmickIdentified ? 'on' : ''}`}
                                  onClick={() =>
                                    patchPreviewPair(row.pairId, {
                                      gimmickIdentified: !row.gimmickIdentified,
                                    })
                                  }
                                >
                                  {row.gimmickIdentified ? '파악 인정' : '파악 불인정'}
                                </button>
                              )}
                            </div>
                          )}
                          {[
                            row.skipped ? row.skipReason : null,
                            row.rescue
                              ? `구조 ${row.rescue.targetLabel} +${row.rescue.restoredHp}`
                              : null,
                            !row.gimmickNote && row.gimmickProgress > 0
                              ? `기믹 +${row.gimmickProgress}`
                              : null,
                            row.itemUses
                              .map((use) => `${use.itemName} (AP ${use.apCost})`)
                              .join(' · ') || null,
                            row.itemDamageToEnemy > 0 ? `아이템 피해 ${row.itemDamageToEnemy}` : null,
                            row.heals.map((heal) => `${heal.targetLabel} 회복 +${heal.amount}`).join(' · ') ||
                              null,
                            row.contractDelta !== 0
                              ? `계약 ${row.contractDelta > 0 ? '+' : ''}${row.contractDelta}`
                              : null,
                            row.stageDrop > 0
                              ? '성좌 상태 하락'
                              : row.stageDrop < 0
                                ? '성좌 상태 회복'
                                : null,
                            row.rewards.map((reward) => `${reward.label} +${reward.points}P`).join(' · ') ||
                              null,
                            row.appliedStatuses.map((s) => s.label).join(' · ') || null,
                          ]
                            .filter(Boolean)
                            .join(' / ')}
                        </td>
                      </tr>
                    ))}

                    {preview.enemies.map((row) => (
                      <tr key={row.enemyId} className="enemy-row">
                        <td>{row.enemyName}</td>
                        <td colSpan={3}>
                          {row.pattern}
                          {row.aoe && <span className="tag critical">광역</span>}
                          {row.blocked && <span className="tag ok">봉인</span>}
                          {row.telegraph && <span className="tag warn">예고</span>}
                        </td>
                        <td>
                          <input
                            className="ctl input tiny"
                            type="number"
                            value={row.damageToHunter}
                            onChange={(event) =>
                              patchPreviewEnemy(
                                row.enemyId,
                                Math.max(0, Number(event.target.value) || 0),
                              )
                            }
                          />
                        </td>
                        <td className="dim small-text">{row.notes[0]}</td>
                      </tr>
                    ))}

                    {preview.statusTicks.map((tick) => (
                      <tr key={`${tick.ownerId}-${tick.defId}`} className="tick-row">
                        <td>{tick.ownerLabel}</td>
                        <td colSpan={3}>{tick.label} 지속 피해</td>
                        <td className="num">{tick.amount}</td>
                        <td className="dim small-text">라운드 종료</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {preview.alerts.length > 0 && (
                  <ul className="preview-alerts">
                    {preview.alerts.map((item) => (
                      <li key={`${item.title}-${item.message}`}>
                        <span className="tag critical">{item.level}</span> {item.title} —{' '}
                        {item.message}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="btn-row">
                  <button
                    type="button"
                    className="ctl primary"
                    onClick={applyPreview}
                  >
                    결과 확정 · APPLY
                  </button>
                  <button type="button" className="ctl" onClick={computeRound}>
                    재계산
                  </button>
                  <button type="button" className="ctl" onClick={() => setPreview(null)}>
                    취소
                  </button>
                </div>
              </div>
            )}
          </section>

          {/*
             운영 도크.
             페어 모니터가 길어지면 상태 확인과 라운드 처리가 화면 양 끝으로 멀어진다.
             지금 필요한 숫자와 다음 한 수를 화면 아래에 붙여 둔다.
          */}
          <section className="panel ops-dock">
            <div className="ops-dock-status">
              <span>
                <i>준비</i>
                <b className={`num ${readyCount === battle.pairs.length ? 'ok-text' : ''}`}>
                  {readyCount}/{battle.pairs.length}
                </b>
              </span>
              <span>
                <i>미제출</i>
                <b className={`num ${waitingSides.length > 0 ? 'warn-text' : ''}`}>
                  {waitingSides.length}
                </b>
              </span>
              <span>
                <i>전투불능</i>
                <b className={`num ${down > 0 ? 'danger-text' : ''}`}>{down}</b>
              </span>
              {battle.gimmick && (
                <span>
                  <i>기믹</i>
                  <b className="num">
                    {battle.gimmick.progress}/{battle.gimmick.required}
                  </b>
                </span>
              )}
            </div>
            <div className="btn-row">
              <button type="button" className="ctl small" onClick={() => jumpTo(chatRef)}>
                채널 ↓
              </button>
              {undoBattle && (
                <button type="button" className="ctl small" onClick={undoApply}>
                  ↩ R{undoBattle.round}
                </button>
              )}
              {waitingSides.length > 0 && (
                <button type="button" className="ctl small" onClick={callWaiting}>
                  호출
                </button>
              )}
              {preview ? (
                <>
                  <button type="button" className="ctl small" onClick={() => jumpTo(processRef)}>
                    결과표
                  </button>
                  <button type="button" className="ctl primary" onClick={applyPreview}>
                    결과 확정 · APPLY
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="ctl primary"
                  disabled={battle.status !== 'ENGAGED'}
                  onClick={computeRound}
                >
                  ROUND {String(battle.round).padStart(2, '0')} 계산
                </button>
              )}
            </div>
          </section>
        </>
      )}

      {/* 채팅 — 어느 탭에서든 보인다 */}
      <div ref={chatRef}>
        <ChatPanel
          channel={battle?.id ?? 'GLOBAL'}
          title={battle ? '작전 채널' : '전체 채널'}
          author={{
            id: operatorHandle,
            name: '관리국',
            role: 'OPERATOR',
            side: null,
          }}
        />
      </div>

      {/* ══════════ 로그 ══════════ */}
      {tab === 'LOG' && (
        <section className="panel log">
          <div className="process-head">
            <div className="btn-row">
              <button
                type="button"
                className={`ctl small ${logTab === 'SYSTEM' ? 'on' : ''}`}
                onClick={() => setLogTab('SYSTEM')}
              >
                시스템 로그
              </button>
              <button
                type="button"
                className={`ctl small ${logTab === 'ROLEPLAY' ? 'on' : ''}`}
                onClick={() => setLogTab('ROLEPLAY')}
              >
                연출 로그
              </button>
            </div>
            {battle && battle.alerts.length > 0 && (
              <button
                type="button"
                className="ctl small"
                onClick={() => update(admin.clearAlerts(battle))}
              >
                경보 지우기
              </button>
            )}
          </div>

          {!battle ? (
            <p className="dim">전투를 열면 로그가 표시됩니다.</p>
          ) : logTab === 'SYSTEM' ? (
            <ol className="log-list">
              {[...battle.log.filter((entry) => entry.channel === 'SYSTEM')]
                .reverse()
                .slice(0, 150)
                .map((entry) => (
                  <li key={entry.id}>
                    <span className="log-time num">[{entry.at}]</span>
                    <span className="log-text">
                      {entry.text}
                      {entry.detail && <small className="dim">{entry.detail}</small>}
                    </span>
                  </li>
                ))}
            </ol>
          ) : (
            <div className="roleplay-list">
              {battle.log.filter((entry) => entry.channel === 'ROLEPLAY').length === 0 && (
                <p className="dim">라운드를 처리하면 연출 로그가 생성됩니다.</p>
              )}
              {[...battle.log.filter((entry) => entry.channel === 'ROLEPLAY')]
                .reverse()
                .map((entry) => (
                  <article className="roleplay-block" key={entry.id}>
                    <header className="roleplay-head">
                      <span className="field-label">
                        ROUND {String(entry.round).padStart(2, '0')} · {entry.at}
                        {entry.edited && <span className="tag warn"> 수정됨</span>}
                      </span>
                      <div className="btn-row">
                        <button
                          type="button"
                          className="ctl small"
                          onClick={() => void copyText(entry.text)}
                        >
                          복사
                        </button>
                        {editingLogId === entry.id ? (
                          <>
                            <button
                              type="button"
                              className="ctl small on"
                              onClick={() => {
                                update(admin.editLogEntry(battle, entry.id, logDraft));
                                setEditingLogId(null);
                              }}
                            >
                              저장
                            </button>
                            <button
                              type="button"
                              className="ctl small"
                              onClick={() => setEditingLogId(null)}
                            >
                              취소
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="ctl small"
                            onClick={() => {
                              setEditingLogId(entry.id);
                              setLogDraft(entry.text);
                            }}
                          >
                            수정
                          </button>
                        )}
                        <button
                          type="button"
                          className="ctl small"
                          title="이 기록을 지웁니다"
                          onClick={() => {
                            if (confirmed('이 연출 기록을 지웁니다. 되돌릴 수 없습니다.')) {
                              update(admin.removeLogEntry(battle, entry.id));
                            }
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </header>
                    {editingLogId === entry.id ? (
                      <textarea
                        className="ctl input textarea roleplay-edit"
                        rows={Math.min(24, logDraft.split('\n').length + 2)}
                        value={logDraft}
                        onChange={(event) => setLogDraft(event.target.value)}
                      />
                    ) : (
                      <pre className="roleplay-text">{entry.text}</pre>
                    )}
                  </article>
                ))}
            </div>
          )}
        </section>
      )}

      {/* ══════════ 공략 기록 ══════════ */}
      {tab === 'ARCHIVE' && (
        <>
          <section className="panel">
            <div className="process-head">
              <h2 className="panel-title">공략 기록 보관</h2>
              <span className="hint">
                끝난 전투는 기록으로 남습니다. 정산을 누르면 전투에서 얻은 포인트와 남은 보급품이
                영구 편성에 반영됩니다.
              </span>
            </div>

            {battle && (battle.status === 'CLEARED' || battle.status === 'FAILED') && (
              <button
                type="button"
                className="ctl wide"
                disabled={busy}
                onClick={() => void archiveBattle(battle)}
              >
                지금 열려 있는 전투를 기록으로 보관 — {battle.operation.name} ·{' '}
                {battle.status === 'CLEARED' ? '클리어' : '실패'}
              </button>
            )}

            {records.length === 0 ? (
              <p className="dim">보관된 기록이 없습니다.</p>
            ) : (
              <div className="record-list">
                {records.map((record) => {
                  const earned = record.pairs.reduce((sum, row) => sum + row.pointsEarned, 0);
                  const settled = record.note.includes('[정산 완료]');

                  return (
                    <article className="panel record" key={record.id}>
                      <header className="process-head">
                        <div>
                          <b>{record.operation.name}</b>{' '}
                          <span className="dim">
                            {record.operation.floor}층 · 위협도 {record.operation.threatLevel} ·{' '}
                            {record.mode}
                          </span>
                          <div className="dim small-text">
                            {shortTime(record.finishedAt)} · {record.rounds} 라운드
                            {record.bossName ? ` · ${record.bossName}` : ''}
                          </div>
                        </div>
                        <div className="btn-row">
                          <span
                            className={`tag ${record.status === 'CLEARED' ? 'ok' : 'critical'}`}
                          >
                            {record.status === 'CLEARED' ? '클리어' : '실패'}
                          </span>
                          {record.gimmick && (
                            <span
                              className={`tag ${
                                record.gimmick.status === 'CLEARED' ? 'ok' : 'warn'
                              }`}
                            >
                              {record.gimmick.label} · {record.gimmick.status}
                            </span>
                          )}
                          <span className="tag gold">총 {earned}P</span>
                          {settled && <span className="tag ok">정산 완료</span>}
                        </div>
                      </header>

                      <table className="preview-table">
                        <thead>
                          <tr>
                            <th>페어</th>
                            <th>헌터</th>
                            <th>성좌</th>
                            <th>HP</th>
                            <th>계약</th>
                            <th>획득</th>
                            <th>보유</th>
                            <th>남은 보급품</th>
                          </tr>
                        </thead>
                        <tbody>
                          {record.pairs.map((row) => (
                            <tr key={row.pairId}>
                              <td>{row.label}</td>
                              <td>{row.hunterName}</td>
                              <td>{row.constellationName}</td>
                              <td className="num">
                                {row.hunterHp}/{row.hunterMaxHp}
                                <small className="dim"> {row.injury}</small>
                              </td>
                              <td>
                                {row.contract.stage}
                                <small className="dim"> {row.contract.value}</small>
                              </td>
                              <td className="num gold">+{row.pointsEarned}</td>
                              <td className="num">{row.pointsTotal}</td>
                              <td>
                                {row.inventory.length === 0 ? (
                                  <span className="dim">없음</span>
                                ) : (
                                  row.inventory.map((stack) => (
                                    <span key={stack.itemId} className="tag">
                                      {findItem(stack.itemId)?.nameKo ?? stack.itemId} ×
                                      {stack.quantity}
                                    </span>
                                  ))
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      <div className="btn-row">
                        <button
                          type="button"
                          className="ctl small on"
                          disabled={busy || earned === 0}
                          onClick={() => void settleRecord(record)}
                        >
                          편성에 정산 반영
                        </button>
                        <button
                          type="button"
                          className="ctl small"
                          onClick={() =>
                            void copyText(
                              record.log.map((entry) => `[${entry.at}] ${entry.text}`).join('\n'),
                            )
                          }
                        >
                          로그 복사
                        </button>
                        <button
                          type="button"
                          className="ctl small"
                          disabled={busy}
                          onClick={() => void removeRecord(record)}
                        >
                          삭제
                        </button>
                      </div>

                      <Collapsible label={`전투 로그 · ${record.log.length}건`}>
                        <ol className="log-list">
                          {record.log.slice(-120).map((entry) => (
                            <li key={entry.id}>
                              <span className="log-time num">[{entry.at}]</span>
                              <span className="log-text">
                                {entry.text}
                                {entry.detail && <small className="dim">{entry.detail}</small>}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </Collapsible>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
