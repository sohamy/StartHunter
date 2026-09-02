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

import { applyShopCatalog, shopRows } from '../config/shop';
import { buildRecord } from '../engine/record';
import {
  AuthError,
  getAccounts,
  getAudit,
  getRoulette,
  getServerAccounts,
  getShop,
  getStorage,
  isServerMode,
  type PublicProfile,
  type SheetRecord,
} from '../store';
import ChatPanel from './ChatPanel';
import TerminalNav from './TerminalNav';
import ArchiveTab from './ops/ArchiveTab';
import BattleOpsTab from './ops/BattleOpsTab';
import EncounterTab from './ops/EncounterTab';
import LogTab from './ops/LogTab';
import OperationSetupTab from './ops/OperationSetupTab';
import { OpsProvider, type OpsShell } from './ops/OpsContext';
import RosterTab from './ops/RosterTab';
import RouletteTab from './ops/RouletteTab';
import SheetTab from './ops/SheetTab';
import ShopTab from './ops/ShopTab';
import { battleTally, terminalUrl } from './ops/shared';
import type {
  BattleRecord,
  BattleState,
  BattleSummary,
  CharacterSheet,
  EnemyTemplate,
  PairBond,
  RouletteSpin,
  RouletteWheel,
  RoundPreview,
  ShopItemRecord,
} from '../types';

type Tab =
  | 'ROSTER'
  | 'SHEET'
  | 'SHOP'
  | 'ROULETTE'
  | 'ENCOUNTER'
  | 'OPERATION'
  | 'LOG'
  | 'ARCHIVE';


/* ── 본체 ──────────────────────────────────────────────── */

export default function ControlTerminal() {
  const storage = useMemo(() => getStorage(), []);
  const accounts = useMemo(() => getAccounts(), []);
  const shop = useMemo(() => getShop(), []);
  const roulette = useMemo(() => getRoulette(), []);
  const audit = useMemo(() => getAudit(), []);
  const serverAccounts = useMemo(() => getServerAccounts(), []);

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

  // 전투 편성 입력

  const [shopItems, setShopItems] = useState<ShopItemRecord[]>([]);
  const [wheels, setWheels] = useState<RouletteWheel[]>([]);
  /** 회전 기록 — 운영진이 전광판을 정리할 수 있어야 한다 */
  const [spins, setSpins] = useState<RouletteSpin[]>([]);
  /** 소지금 지급 대상 — 페어 id 마다 기억한다. BOTH 는 두 사람이 각자 받는다. */
  /** 페어가 늘면 카드 하나가 화면 한 장을 먹는다 — 기본은 접어 둔다 */
  /** 일괄 조작 대상 페어 */
  /** 직전 확정을 한 번만 되돌린다 — 손으로 수치를 복원하는 일을 없앤다 */
  /** 운영 도크에서 곧장 뛰어갈 자리들 — 긴 화면을 오르내리지 않게 한다 */
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
      const [
        profileRows,
        sheetRows,
        bondRows,
        templateRows,
        battleRows,
        recordRows,
        shopRecords,
        wheelRows,
        spinRows,
      ] = await Promise.all([
        accounts.listProfiles(),
        accounts.listSheets(),
        storage.listBonds(),
        storage.listEnemyTemplates(),
        storage.listBattles(),
        storage.listRecords(),
        shop.listItems(),
        roulette.listWheels(),
        roulette.recentSpins(200),
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
      setWheels(wheelRows);
      setSpins(spinRows);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `데이터를 불러올 수 없습니다: ${caught.message}`
          : '데이터를 불러올 수 없습니다.',
      );
    }
  }, [accounts, roulette, shop, storage]);

  useEffect(() => {
    if (access === 'GRANTED' || access === 'LOCAL') void refresh();
  }, [access, refresh]);

  useEffect(() => {
    (async () => {
      if (!serverAccounts) return;
      const session = await serverAccounts.currentSession();
      if (!session) {
        setAccess('DENIED');
        return;
      }
      setAccess((await serverAccounts.isOperator()) ? 'GRANTED' : 'DENIED');
    })();
  }, [serverAccounts]);

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
    if (!id) return;
    return storage.subscribe(id, () => void syncSubmissions(id));
  }, [battle?.id, storage, syncSubmissions]);

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
  /**
   * 전투를 화면에 연다.
   *
   * 사람이 직접 연 뒤에는 자동 열기가 다시 끼어들지 않아야 한다 —
   * 닫아 둔 전투를 새로고침 때마다 되살리면 운영진이 화면을 못 벗어난다.
   */
  const openBattle = useCallback(
    (next: BattleState) => {
      autoOpened.current = true;
      update(next);
      setTab('OPERATION');
    },
    [update],
  );

  /** 화면에서만 닫는다 — 전투는 서버에 남는다 */
  const closeBattle = useCallback(() => {
    autoOpened.current = true;
    setBattle(null);
    setPreview(null);
    void refresh();
  }, [refresh]);

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
    if (!serverAccounts) return;
    setBusy(true);
    setMessage(null);
    try {
      await serverAccounts.login({ id: operatorId, password: operatorPassword });
      if (await serverAccounts.isOperator()) {
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
        <TerminalNav current="control" />
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

  archiveBattleRef.current = archiveBattle;

  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage('클립보드에 복사했습니다.');
    } catch {
      setMessage('복사에 실패했습니다.');
    }
  }, []);

  /* 탭이 공통으로 쓰는 배선 — 여기 한 곳에서만 엮는다 */
  const shell: OpsShell = useMemo(
    () => ({
      storage,
      accounts,
      shop,
      roulette,
      audit,
      busy,
      setBusy,
      guard,
      refresh,
      setMessage,
      setError,
      copyText,
    }),
    [storage, accounts, shop, roulette, audit, busy, guard, refresh, copyText],
  );


  /* ── 전투 파생값 ─────────────────────────────────── */

  const activeBonds = bonds.filter((row) => row.active);
  /* 상단 상황판이 읽는 수 — 전투 탭과 같은 곳에서 센다 */
  const { down, readyCount, waitingSides } = battleTally(battle);
  /* ── 화면 ────────────────────────────────────────── */

  return (
    <OpsProvider value={shell}>
      <div className="console wide">
        <TerminalNav current="control" />
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
              ['ROULETTE', `도박장 · ${wheels.length}`],
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
                  await accounts.logout();
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
          <RosterTab
            bonds={bonds}
            activeBonds={activeBonds}
            profiles={profiles}
            sheets={sheets}
            sheetOf={sheetOf}
          />
        )}

        {/* ══════════ 참가자 시트 ══════════ */}
        {tab === 'SHEET' && (
          <SheetTab
            sheets={sheets}
            profiles={profiles}
            activeBonds={activeBonds}
            sheetOf={sheetOf}
          />
        )}

        {/* ══════════ 적 세팅 ══════════ */}
        {tab === 'SHOP' && <ShopTab shopItems={shopItems} />}

        {/* ══════════ 도박장 ══════════ */}
        {tab === 'ROULETTE' && <RouletteTab wheels={wheels} spins={spins} />}

        {tab === 'ENCOUNTER' && <EncounterTab templates={templates} />}

        {/* ══════════ 전투 ══════════ */}
        {tab === 'OPERATION' && !battle && (
          <OperationSetupTab
            bonds={bonds}
            activeBonds={activeBonds}
            templates={templates}
            battles={battles}
            sheets={sheets}
            sheetOf={sheetOf}
            openBattle={openBattle}
          />
        )}

        {tab === 'OPERATION' && battle && (
          <BattleOpsTab
            battle={battle}
            update={update}
            setBattle={setBattle}
            preview={preview}
            setPreview={setPreview}
            activeBonds={activeBonds}
            sheetOf={sheetOf}
            operatorHandle={operatorHandle}
            chatRef={chatRef}
            archiveBattle={archiveBattle}
            closeBattle={closeBattle}
          />
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
        {tab === 'LOG' && <LogTab battle={battle} update={update} />}

        {/* ══════════ 공략 기록 ══════════ */}
        {tab === 'ARCHIVE' && (
          <ArchiveTab
            battle={battle}
            records={records}
            sheets={sheets}
            bonds={bonds}
            archiveBattle={archiveBattle}
          />
        )}
      </div>
    </OpsProvider>
  );
}
