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

import { GIMMICK_DEFINITIONS } from '../config/gimmicks';
import { PATTERN_SETS } from '../config/patterns';
import { CONSTELLATION_STAGES, CONTRACT_STAGES } from '../config/rules';
import { DEFAULT_OPERATION } from '../config/scenario';
import { STATUS_DEFINITIONS } from '../config/status';
import * as admin from '../engine/admin';
import {
  assembleBattle,
  enemyFromTemplate,
  pairReady,
  type BondEntry,
} from '../engine/battle';
import { nextPatternAdmin } from '../engine/enemy';
import { newUuid } from '../engine/id';
import { applyRound, previewRound } from '../engine/round';
import { injuryOf, statusViews } from '../engine/status';
import {
  AuthError,
  getAuth,
  getServerAuth,
  getServerStorage,
  getStorage,
  isServerMode,
  type PublicProfile,
  type SheetRecord,
} from '../store';
import AttackEditor from './AttackEditor';
import ChatPanel from './ChatPanel';
import Collapsible from './Collapsible';
import SheetEditor from './SheetEditor';
import { ActorSheet, SheetDetail, sideLabel } from './SheetView';
import type {
  ActorSide,
  BattleState,
  BattleSummary,
  CharacterSheet,
  ConstellationStage,
  ContractStage,
  EnemyState,
  EnemyTemplate,
  PairBond,
  RoundPreview,
  StatusEffect,
  StatusHolder,
} from '../types';

type Tab = 'ROSTER' | 'SHEET' | 'ENCOUNTER' | 'OPERATION' | 'LOG';
type PairFilter = 'ALL' | 'GOVERNMENT' | 'GUILD' | 'INJURED' | 'DOWN' | 'NOT_SUBMITTED';
type SheetFilter = 'ALL' | 'HUNTER' | 'CONSTELLATION' | 'UNPAIRED';
type LogTab = 'SYSTEM' | 'ROLEPLAY';

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

  return (
    <label className="num-field">
      <span className="field-label">{label}</span>
      <input
        className="ctl input"
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
  return (
    <label className="num-field">
      <span className="field-label">{label}</span>
      <input
        className="ctl input"
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
  const [sheetQuery, setSheetQuery] = useState('');
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null);
  const [logTab, setLogTab] = useState<LogTab>('SYSTEM');
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [logDraft, setLogDraft] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [profileRows, sheetRows, bondRows, templateRows, battleRows] = await Promise.all([
        auth.listProfiles(),
        auth.listSheets(),
        storage.listBonds(),
        storage.listEnemyTemplates(),
        storage.listBattles(),
      ]);
      setProfiles(profileRows);
      setSheets(sheetRows);
      setBonds(bondRows);
      setTemplates(templateRows);
      setBattles(battleRows);
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

  const createBond = async () => {
    if (!pairingHunter || !pairingConstellation) {
      setError('헌터와 성좌를 모두 선택하세요.');
      return;
    }
    if (pairingHunter === pairingConstellation) {
      setError('한 참가자가 양쪽을 맡을 수 없습니다.');
      return;
    }

    const hunter = profiles.find((row) => row.accountId === pairingHunter);
    const constellation = profiles.find((row) => row.accountId === pairingConstellation);
    const taken = bonds.find(
      (row) =>
        row.active &&
        (row.hunterAccountId === pairingHunter ||
          row.constellationAccountId === pairingConstellation),
    );
    if (taken) {
      setError(`이미 ${taken.label} 에 편성된 참가자가 있습니다. 먼저 해산하세요.`);
      return;
    }

    const bond: PairBond = {
      id: newId(),
      label: `PAIR ${String(bonds.filter((row) => row.active).length + 1).padStart(2, '0')}`,
      hunterAccountId: pairingHunter,
      constellationAccountId: pairingConstellation,
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

  /** 시트 소유자가 속한 활성 페어 */
  const bondOf = (accountId: string) =>
    activeBonds.find(
      (bond) =>
        bond.hunterAccountId === accountId || bond.constellationAccountId === accountId,
    ) ?? null;

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
        (row.sheet.concept ?? '').toLowerCase().includes(query) ||
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
            ['ENCOUNTER', `적 세팅 · ${templates.length}`],
            ['OPERATION', battle ? `전투 · ROUND ${battle.round}` : '전투'],
            ['LOG', '로그'],
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
        <p className="notice ok" onClick={() => setMessage(null)} title="클릭하면 닫기">
          {message}
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
                      <b>{bond.label}</b>
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
                      onCommit={(value) => void patchTemplate(template, { maxPhase: value })}
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
                            {set.id}
                          </option>
                        ))}
                      </select>
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
                    label={`공격 패턴 ${(template.attacks ?? []).length}개 — 페이즈별로 적용`}
                    defaultOpen={(template.attacks ?? []).length > 0}
                  >
                    <AttackEditor
                      attacks={template.attacks ?? []}
                      maxPhase={template.maxPhase}
                      enemyAttack={template.attack}
                      onChange={(attacks) => void patchTemplate(template, { attacks })}
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
                <option value="">없음</option>
                {GIMMICK_DEFINITIONS.map((def) => (
                  <option key={def.id} value={def.id}>
                    {def.labelKo} · {def.required}회 / {def.roundLimit ?? '∞'}R
                  </option>
                ))}
              </select>
            </label>
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
                <button
                  type="button"
                  className="ctl primary"
                  onClick={() => update(admin.forceAutoForUnsubmitted(battle))}
                >
                  전원 자동 위임
                </button>
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
                  <Collapsible label={`공격 패턴 ${(enemy.attacks ?? []).length}개`}>
                    <AttackEditor
                      attacks={enemy.attacks ?? []}
                      maxPhase={enemy.maxPhase}
                      enemyAttack={enemy.attack}
                      onChange={(attacks) =>
                        update(admin.setEnemyAttacks(battle, enemy.id, attacks))
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
              </div>
            </div>

            <div className="monitor-grid">
              {filteredPairs.map((pair) => {
                const injury = injuryOf(pair.hunter);
                const ready = pairReady(pair);

                return (
                  <article key={pair.id} className={`monitor-card ${ready ? 'ready' : ''}`}>
                    <header className="monitor-head">
                      <div>
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

                    {/* 판정 근거 — 스탯과 스킬을 모르면 기믹도 연출도 판정할 수 없다 */}
                    <Collapsible label="시트 · 스킬 (판정 참고)">
                      <div className="sheet-list">
                        <ActorSheet
                          side="HUNTER"
                          name={pair.hunter.name}
                          classId={pair.hunter.classId}
                          stats={pair.hunter.stats}
                          skills={pair.hunter.skills}
                          accountId={pair.hunterAccountId}
                          concept={sheetOf(pair.hunterAccountId)?.concept}
                        />
                        <ActorSheet
                          side="CONSTELLATION"
                          name={pair.constellation.name}
                          classId={pair.constellation.classId}
                          stats={pair.constellation.stats}
                          skills={pair.constellation.skills}
                          accountId={pair.constellationAccountId}
                          concept={sheetOf(pair.constellationAccountId)?.concept}
                        />
                      </div>
                    </Collapsible>

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
                    </Collapsible>
                  </article>
                );
              })}
            </div>
          </section>

          {/* 라운드 처리 */}
          <section className="panel process">
            <div className="process-head">
              <h2 className="panel-title">ROUND {String(battle.round).padStart(2, '0')} 처리</h2>
              <span className="hint">
                APPLY 전에 피해량과 연계를 직접 수정할 수 있습니다. 자동 계산은 제안일 뿐입니다.
              </span>
            </div>

            {!preview ? (
              <button
                type="button"
                className="ctl wide"
                disabled={battle.status !== 'ENGAGED'}
                onClick={() => setPreview(previewRound(battle))}
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
                    onClick={() => {
                      setBattle(applyRound(battle, preview));
                      setPreview(null);
                      setMessage(
                        `ROUND ${battle.round} 결과를 확정했습니다. 연출 로그가 만들어졌고 참가자 화면이 갱신됩니다.`,
                      );
                    }}
                  >
                    결과 확정 · APPLY
                  </button>
                  <button
                    type="button"
                    className="ctl"
                    onClick={() => setPreview(previewRound(battle))}
                  >
                    재계산
                  </button>
                  <button type="button" className="ctl" onClick={() => setPreview(null)}>
                    취소
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      )}

      {/* 채팅 — 어느 탭에서든 보인다 */}
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
    </div>
  );
}
