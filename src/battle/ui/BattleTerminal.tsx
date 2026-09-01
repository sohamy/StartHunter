/**
 * 참가자 전투 단말.
 *
 * 이 컴포넌트는 전투 규칙을 계산하지 않는다.
 * 모든 판정은 engine/ 에, 모든 수치는 config/ 에 있다.
 *
 * 진입 조건: 계약자 등록(로그인)이 되어 있어야 한다.
 *
 * 서버 모드에서 참가자는 **전투 상태를 쓰지 않는다**.
 * 자기 쪽 제출만 `submitSide()` 로 보내고, 나머지는 구독으로 받아 본다.
 * 라운드 처리는 관리국이 하므로, 화면이 스스로 갱신되지 않으면 진행을 볼 수 없다.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { describeTraits, findClass } from '../config/characters';
import { ITEM_CATEGORY_LABELS, findItem as findItemDefinition } from '../config/items';
import { CURRENT_PHASE, UI_RULES } from '../config/rules';
import { DEFAULT_RAID_PAIR_COUNT, pairPreset, presetSheet } from '../config/scenario';
import {
  createBattle,
  pairReady,
  resolveTarget,
  sideOfAccount,
  sideReady,
  viewerPair,
} from '../engine/battle';
import { previewCombo } from '../engine/combo';
import { formatDice } from '../engine/dice';
import {
  availableStage,
  declarationValid,
  gimmickBrief,
  planCheck,
  rollCheck,
} from '../engine/gimmick';
import { newUuid } from '../engine/id';
import { bagOf, inventoryFor, itemAvailability } from '../engine/items';
import {
  actionAvailability,
  apCostOf,
  setControlMode,
  submitPairAction,
  submittedItemId,
} from '../engine/round';
import { actionsFor, findSkillRuntime, resolveActionFor } from '../engine/skills';
import {
  constellationView,
  contractView,
  injuryOf,
  isDown,
  statusViews,
} from '../engine/status';
import { getAuth, getServerStorage, getStorage, loadShopCatalog, type PublicProfile } from '../store';
import ChatPanel from './ChatPanel';
import { Portrait } from './PortraitField';
import Collapsible from './Collapsible';
import { ActorSheet } from './SheetView';
import TerminalNav from './TerminalNav';
import type {
  ActionDefinition,
  Account,
  ActorSide,
  BattleMode,
  BattleState,
  CharacterSheet,
  EnemyState,
  GimmickState,
  PairBond,
  PairState,
  StatusEffect,
} from '../types';

/** 서버에 보내는 제출 조각 — 자기 쪽 칼럼만 담는다 */
interface SidePatch {
  actionId?: string | null;
  targetEnemyId?: string | null;
  supportTargetPairId?: string | null;
  gimmickNote?: string | null;
  gimmickStage?: string | null;
  gimmickCheck?: unknown;
  itemId?: string | null;
  submitted?: boolean;
}

function joinUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/battle/join/`;
}

/* ── 작은 표시 요소 ────────────────────────────────────── */

function ApDots({ current, max }: { current: number; max: number }) {
  return (
    <span className="ap-dots" aria-label={`행동력 ${current} / ${max}`}>
      {Array.from({ length: Math.max(max, current) }, (_, index) => (
        <i key={index} className={index < current ? 'on' : 'off'} />
      ))}
    </span>
  );
}

function Gauge({ value, max, tone = 'ok' }: { value: number; max: number; tone?: string }) {
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`gauge tone-${tone}`}>
      <div className="gauge-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <span className="field-value">{children}</span>
    </div>
  );
}

function StatusChips({ statuses }: { statuses: StatusEffect[] }) {
  const views = statusViews(statuses);
  if (views.length === 0) return <span className="dim">NONE</span>;

  return (
    <>
      {views.map((view) => (
        <span key={view.defId} className={`tag ${view.tone}`} title={view.description}>
          {view.label}
          {view.stacks > 1 && <b> ×{view.stacks}</b>}
          <small> {view.remainingRounds}R</small>
        </span>
      ))}
    </>
  );
}

/* ── 행동 목록 ─────────────────────────────────────────── */

interface ActionListProps {
  actions: ActionDefinition[];
  pair: PairState;
  side: ActorSide;
  target: EnemyState | null;
  selectedId: string | null;
  locked: boolean;
  /** 이 층의 기믹 — 없으면 기믹 수행이 잠긴다 */
  gimmick: GimmickState | null;
  onSelect: (actionId: string) => void;
}

function ActionList({
  actions,
  pair,
  side,
  target,
  selectedId,
  locked,
  gimmick,
  onSelect,
}: ActionListProps) {
  return (
    <ul className="action-list">
      {actions.map((action) => {
        const availability = actionAvailability(action, pair, Boolean(target), gimmick);
        const disabled = locked || !availability.usable;
        const future = action.implementedIn > CURRENT_PHASE;
        const skill = findSkillRuntime(pair, side, action.id);
        const manifestLeft =
          action.kind === 'MANIFEST'
            ? pair.constellation.manifestUses.partial
            : action.kind === 'FULL_MANIFEST'
              ? pair.constellation.manifestUses.full
              : null;

        return (
          <li key={action.id}>
            <button
              type="button"
              className={[
                'action',
                selectedId === action.id ? 'selected' : '',
                future ? 'future' : '',
                skill ? 'custom' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={disabled}
              onClick={() => onSelect(action.id)}
              title={availability.reason ?? action.description}
            >
              <span className="action-name">
                {action.label}
                <small>{action.labelKo}</small>
              </span>
              <span className="action-cost">AP {apCostOf(action, pair)}</span>
              <span className="action-meta">
                {skill && skill.cooldown > 0 && <span className="tag">쿨 {skill.cooldown}R</span>}
                {skill && skill.currentCooldown > 0 && (
                  <span className="tag warn">대기 {skill.currentCooldown}R</span>
                )}
                {skill?.remainingUses !== null && skill?.remainingUses !== undefined && (
                  <span className="tag">{skill.remainingUses}회 남음</span>
                )}
                {skill?.applyStatusIds.map((defId) => (
                  <span key={defId} className="tag warn">
                    {defId}
                  </span>
                ))}
                {manifestLeft !== null && <span className="tag gold">{manifestLeft}회 남음</span>}
              </span>
              {!availability.usable && <span className="action-block">{availability.reason}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 아이템 선택.
 *
 * 아이템 행동을 고른 다음에 무엇을 쓸지 정한다 —
 * 행동력 비용과 대상은 행동 정의가 아니라 아이템 정의에서 온다.
 */
interface ItemPickerProps {
  pair: PairState;
  side: ActorSide;
  hasTarget: boolean;
  supportPair: PairState | null;
  selectedId: string | null;
  locked: boolean;
  onSelect: (itemId: string | null) => void;
}

function ItemPicker({
  pair,
  side,
  hasTarget,
  supportPair,
  selectedId,
  locked,
  onSelect,
}: ItemPickerProps) {
  const rows = inventoryFor(pair, side);

  if (rows.length === 0) {
    return <p className="hint">가방에 이 주체가 쓸 수 있는 아이템이 없습니다.</p>;
  }

  return (
    <ul className="action-list item-list">
      {rows.map((row) => {
        const availability = itemAvailability(pair, side, row.item.id, hasTarget, supportPair);
        const disabled = locked || !availability.usable;

        return (
          <li key={row.item.id}>
            <button
              type="button"
              className={['action', selectedId === row.item.id ? 'selected' : ''].join(' ').trim()}
              disabled={disabled}
              onClick={() => onSelect(selectedId === row.item.id ? null : row.item.id)}
              title={availability.reason ?? row.item.description}
            >
              <span className="action-name">
                {row.item.name}
                <small>{row.item.nameKo}</small>
              </span>
              <span className="action-cost">AP {row.item.apCost}</span>
              <span className="action-meta">
                <span className="tag">{ITEM_CATEGORY_LABELS[row.item.category].labelKo}</span>
                <span className="tag gold">{row.quantity}개</span>
                {row.effects.map((effect) => (
                  <span key={effect} className="tag ok">
                    {effect}
                  </span>
                ))}
              </span>
              {!availability.usable && <span className="action-block">{availability.reason}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** 개인 가방 — 전투 화면에서는 보유량만 확인한다. 두 사람의 가방은 섞이지 않는다. */
function InventoryList({ pair, side }: { pair: PairState; side: ActorSide }) {
  const bag = bagOf(pair, side);
  if (bag.length === 0) {
    return <p className="hint">보급품이 없습니다.</p>;
  }
  return (
    <ul className="inventory-list">
      {bag.map((stack) => {
        const item = findItemDefinition(stack.itemId);
        if (!item) return null;
        return (
          <li key={stack.itemId}>
            <span>{item.nameKo}</span>
            <span className="tag">{ITEM_CATEGORY_LABELS[item.category].labelKo}</span>
            <b className="num gold">{stack.quantity}</b>
          </li>
        );
      })}
    </ul>
  );
}

/* ── 본체 ──────────────────────────────────────────────── */

export default function BattleTerminal() {
  const storage = useMemo(() => getStorage(), []);
  const serverStorage = useMemo(() => getServerStorage(), []);
  const auth = useMemo(() => getAuth(), []);

  const [authState, setAuthState] = useState<'LOADING' | 'GUEST' | 'READY'>('LOADING');
  const [account, setAccount] = useState<Account | null>(null);
  const [partners, setPartners] = useState<PublicProfile[]>([]);
  /** 활동명 → 사진. 전투 상태에는 사진이 없어 공개 프로필에서 받아 둔다 */
  const [portraits, setPortraits] = useState<Record<string, string>>({});
  const [partnerId, setPartnerId] = useState('');
  const [setupMode, setSetupMode] = useState<BattleMode>('DUEL');

  const [battle, setBattle] = useState<BattleState | null>(null);
  const [gimmickDraft, setGimmickDraft] = useState('');
  /** 기믹 수행을 고른 순간 선언칸으로 데려간다 — 위아래로 찾아다니지 않게 한다 */
  const gimmickBox = useRef<HTMLTextAreaElement>(null);
  /** 확정 바에서 채널로 바로 내려간다 — 대화하려고 화면을 훑지 않게 한다 */
  const chatBox = useRef<HTMLDivElement>(null);
  /** 제출이 서버에 닿지 않았을 때의 안내 — 조용히 삼키면 안 된다 */
  const [syncError, setSyncError] = useState<string | null>(null);
  /** 경보 닫기는 이 단말에서만 유효하다 (전투 상태는 관리국 소유) */
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  /** 내가 속한 영구 편성 — 전투가 아직 없을 때 진행 상황을 알려 준다 */
  const [myBond, setMyBond] = useState<PairBond | null>(null);

  const battleId = account ? `BATTLE-${account.id}` : null;

  /** 내 계정이 배정된 전투를 찾는다. 관리국이 편성하면 여기에 걸린다. */
  const findAssignedBattle = useCallback(
    async (accountId: string): Promise<BattleState | null> => {
      for (const summary of await storage.listBattles()) {
        if (summary.status === 'CLEARED' || summary.status === 'FAILED') continue;
        const candidate = await storage.loadBattle(summary.id);
        if (!candidate) continue;
        const myPair = candidate.pairs.find(
          (row) => row.hunterAccountId === accountId || row.constellationAccountId === accountId,
        );
        if (myPair) return { ...candidate, viewerPairId: myPair.id };
      }
      return null;
    },
    [storage],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 운영진이 만든 아이템도 이름 · 효과가 떠야 한다
      await loadShopCatalog();

      const session = await auth.currentSession();
      if (!session) {
        if (!cancelled) setAuthState('GUEST');
        return;
      }

      const found = await auth.getAccount(session.accountId);
      if (!found) {
        if (!cancelled) setAuthState('GUEST');
        return;
      }

      const opposite: ActorSide = found.sheet.side === 'HUNTER' ? 'CONSTELLATION' : 'HUNTER';
      const everyone = await auth.listProfiles();
      const profiles = everyone.filter(
        (profile) => profile.side === opposite && profile.accountId !== found.id,
      );
      const faces: Record<string, string> = {};
      for (const profile of everyone) {
        if (profile.portrait) faces[profile.accountId] = profile.portrait;
      }
      if (found.sheet.portrait) faces[found.id] = found.sheet.portrait;
      const joined = await findAssignedBattle(found.id);

      if (cancelled) return;
      setAccount(found);
      setPortraits(faces);
      setPartners(profiles);
      setBattle(joined);
      setAuthState('READY');
    })();

    return () => {
      cancelled = true;
    };
  }, [auth, findAssignedBattle]);

  useEffect(() => {
    // 서버 모드에서 전투 상태는 관리국만 쓴다. 참가자는 제출만 보낸다.
    if (battle && !serverStorage) void storage.saveBattle(battle);
  }, [battle, serverStorage, storage]);

  const update = useCallback((next: BattleState) => {
    setBattle(next);
  }, []);

  /** 서버 상태를 다시 읽어 화면을 맞춘다. 보고 있는 페어는 유지한다. */
  const reload = useCallback(
    async (id: string) => {
      const next = await storage.loadBattle(id);
      if (!next) return;
      setBattle((current) => {
        if (!current || current.id !== next.id) return current;
        const keep = next.pairs.some((row) => row.id === current.viewerPairId)
          ? current.viewerPairId
          : next.viewerPairId;
        return { ...next, viewerPairId: keep };
      });
    },
    [storage],
  );

  /**
   * 라운드 처리 결과와 상대의 제출을 자동으로 받아 본다.
   * 새로고침을 눌러야 진행이 보이는 화면은 쓸 수 없다.
   */
  useEffect(() => {
    const id = battle?.id;
    if (!id || !serverStorage) return;

    const stop = serverStorage.subscribe(id, () => void reload(id));
    // Realtime 이 끊겨도 진행이 멈추지 않도록 주기적으로도 확인한다
    const timer = window.setInterval(() => void reload(id), 15000);
    return () => {
      stop();
      window.clearInterval(timer);
    };
  }, [battle?.id, reload, serverStorage]);

  /** 배정 대기 중에는 편성과 전투가 준비됐는지 스스로 확인한다 */
  const checkAssignment = useCallback(async () => {
    if (!account) return;
    setChecking(true);
    try {
      const bonds = await storage.listBonds();
      setMyBond(
        bonds.find(
          (row) =>
            row.active &&
            (row.hunterAccountId === account.id || row.constellationAccountId === account.id),
        ) ?? null,
      );

      const found = await findAssignedBattle(account.id);
      if (found) setBattle(found);
    } finally {
      setChecking(false);
    }
  }, [account, findAssignedBattle, storage]);

  useEffect(() => {
    if (authState === 'READY' && !battle) void checkAssignment();
    // 최초 진입에서 한 번 — 이후는 아래 주기 확인이 맡는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState]);

  useEffect(() => {
    if (authState !== 'READY' || battle || !account) return;
    const timer = window.setInterval(() => void checkAssignment(), 10000);
    return () => window.clearInterval(timer);
  }, [account, authState, battle, checkAssignment]);

  /**
   * 내 쪽 제출을 서버에 보낸다.
   * 서버 모드에서는 이것만이 다른 참가자와 관리국에 전달되는 경로다.
   */
  const pushSide = useCallback(
    async (pairId: string, round: number, side: ActorSide, patch: SidePatch) => {
      if (!serverStorage) return;
      try {
        await serverStorage.submitSide(pairId, round, side, patch);
        setSyncError(null);
      } catch (caught) {
        setSyncError(
          caught instanceof Error
            ? `제출이 서버에 저장되지 않았습니다: ${caught.message}`
            : '제출이 서버에 저장되지 않았습니다.',
        );
      }
    },
    [serverStorage],
  );

  const startBattle = useCallback(async () => {
    if (!account || !battleId) return;

    const mySheet = account.sheet;
    let partnerSheet: CharacterSheet | null = null;

    if (partnerId) {
      const partnerAccount = await auth.getAccount(partnerId);
      partnerSheet = partnerAccount?.sheet ?? null;
    }

    if (!partnerSheet) {
      const preset = pairPreset(0);
      const side: ActorSide = mySheet.side === 'HUNTER' ? 'CONSTELLATION' : 'HUNTER';
      partnerSheet = presetSheet(
        side === 'HUNTER' ? preset.hunter : preset.constellation,
        side,
        mySheet.affiliation,
        0,
      );
    }

    const hunterSheet = mySheet.side === 'HUNTER' ? mySheet : partnerSheet;
    const constellationSheet = mySheet.side === 'CONSTELLATION' ? mySheet : partnerSheet;

    setBattle(
      createBattle({
        id: battleId,
        mode: setupMode,
        pairCount: setupMode === 'RAID' ? DEFAULT_RAID_PAIR_COUNT : 1,
        monsterCount: setupMode === 'RAID' ? 1 : 0,
        primaryPair: {
          hunterSheet,
          constellationSheet,
          affiliation: hunterSheet.affiliation,
          // 1인 = 1캐릭터. 내 계정은 내 쪽에만 붙는다.
          hunterAccountId: mySheet.side === 'HUNTER' ? account.id : partnerId || null,
          constellationAccountId: mySheet.side === 'CONSTELLATION' ? account.id : partnerId || null,
        },
      }),
    );
  }, [account, auth, battleId, partnerId, setupMode]);

  /* ── 진입 게이트 ─────────────────────────────────── */

  if (authState === 'LOADING') {
    return <div className="console-loading">VERIFYING CONTRACT…</div>;
  }

  if (authState === 'GUEST' || !account) {
    return (
      <div className="console">
        <TerminalNav current="battle" />
        <header className="console-head">
          <div className="agency">
            <b>HUNTER MANAGEMENT AGENCY</b>
            <span>TOWER RAID CONTROL SYSTEM</span>
          </div>
          <span className="tag critical">ACCESS DENIED</span>
        </header>
        <section className="panel">
          <h2 className="panel-title">CONTRACT REQUIRED</h2>
          <p>
            전투 단말은 계약자 등록을 마친 참가자만 사용할 수 있습니다.
            <br />
            캐릭터 시트를 작성하면 그 수치로 페어가 편성됩니다.
          </p>
          <div className="btn-row" style={{ marginTop: 16 }}>
            <a className="ctl primary" href={joinUrl()}>
              계약자 등록 · 로그인으로 이동
            </a>
          </div>
        </section>
      </div>
    );
  }

  /* ── 전투 편성 ───────────────────────────────────── */

  const mySheetClass = findClass(account.sheet.side, account.sheet.classId);

  if (!battle) {
    return (
      <div className="console">
        <TerminalNav
          current="battle"
          who={{ name: account.sheet.name, side: account.sheet.side }}
        />
        <header className="console-head">
          <div className="agency">
            <b>HUNTER MANAGEMENT AGENCY</b>
            <span>TOWER RAID CONTROL SYSTEM</span>
          </div>
          <dl className="ops">
            <Field label="ACCOUNT">{account.id}</Field>
            <Field label="ROLE">
              <span className={`tag ${account.sheet.side === 'HUNTER' ? 'blue' : 'gold'}`}>
                {account.sheet.side}
              </span>
            </Field>
            <Field label="NAME">{account.sheet.name}</Field>
          </dl>
        </header>

        <section className="panel">
          <h2 className="panel-title">배정 대기</h2>
          <p>
            {account.sheet.name} · {mySheetClass?.label ?? '—'} 시트로 등록되어 있습니다.
            <br />
            <b>페어 편성과 전투 시작은 관리국(운영진)이 진행합니다.</b> 전투가 열리면 이 화면이
            스스로 전투 단말로 바뀝니다 — 새로고침하지 않아도 됩니다.
          </p>

          {/* 편성만 끝나도 전투 단말은 열리지 않는다 — 두 단계를 나눠서 보여준다 */}
          <ol className="progress-steps">
            <li className={myBond ? 'done' : 'now'}>
              <span className="field-label">1 · 페어 편성</span>
              {myBond ? (
                <b className="ok-text">
                  {myBond.label} — {myBond.hunterName} × {myBond.constellationName}
                </b>
              ) : (
                <b className="warn-text">아직 편성되지 않았습니다. 관리국의 편성을 기다립니다.</b>
              )}
            </li>
            <li className={myBond ? 'now' : ''}>
              <span className="field-label">2 · 전투 시작</span>
              <b className={myBond ? 'warn-text' : 'dim'}>
                {myBond
                  ? '관리국이 이 페어를 전투에 배치하면 자동으로 입장합니다.'
                  : '편성이 끝난 뒤 진행됩니다.'}
              </b>
            </li>
          </ol>
          <div className="btn-row" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="ctl"
              disabled={checking}
              onClick={() => void checkAssignment()}
            >
              {checking ? '확인 중…' : '지금 배정 확인'}
            </button>
            <a className="ctl small" href={joinUrl()}>
              내 시트 보기
            </a>
            <span className="hint">10초마다 자동으로 확인합니다.</span>
          </div>
        </section>

        <section className="panel">
          <h2 className="panel-title">SOLO TEST</h2>
          <p className="hint" style={{ marginBottom: 12 }}>
            운영진 편성 없이 규칙을 확인해 보는 테스트 경로입니다. 상대 쪽은 프리셋 캐릭터가 맡고,
            실제 진행에는 사용하지 않습니다.
          </p>
          <div className="session-row">
            <span className="field-label">PARTNER</span>
            <select
              className="ctl"
              value={partnerId}
              onChange={(event) => setPartnerId(event.target.value)}
            >
              <option value="">프리셋 캐릭터</option>
              {partners.map((profile) => (
                <option key={profile.accountId} value={profile.accountId}>
                  {profile.name} · {profile.accountId}
                </option>
              ))}
            </select>
          </div>
          <div className="session-row">
            <span className="field-label">SCALE</span>
            <div className="btn-row">
              <button
                type="button"
                className={`ctl ${setupMode === 'DUEL' ? 'on' : ''}`}
                onClick={() => setSetupMode('DUEL')}
              >
                DUEL · 페어 1조
              </button>
              <button
                type="button"
                className={`ctl ${setupMode === 'RAID' ? 'on' : ''}`}
                onClick={() => setSetupMode('RAID')}
              >
                RAID · {DEFAULT_RAID_PAIR_COUNT}페어
              </button>
            </div>
          </div>
          <button type="button" className="ctl wide" onClick={() => void startBattle()}>
            START TEST OPERATION
          </button>
        </section>
      </div>
    );
  }

  /* ── 전투 진행 ───────────────────────────────────── */

  const pair = viewerPair(battle);
  const target = resolveTarget(battle, pair);
  const injury = injuryOf(pair.hunter);
  const constellation = constellationView(pair.constellation.stage);
  const contract = contractView(pair.contract.stage);
  const hunterClass = findClass('HUNTER', pair.hunter.classId);
  const constellationClass = findClass('CONSTELLATION', pair.constellation.classId);
  const submission = pair.submission;

  // 1인 = 1캐릭터. 내 계정이 맡은 쪽만 조작할 수 있다.
  const mySide = sideOfAccount(pair, account.id);
  const engaged = battle.status === 'ENGAGED';
  const hunterLocked =
    mySide !== 'HUNTER' || submission.hunterSubmitted || !engaged || pair.hunter.control === 'AUTO';
  const constellationLocked =
    mySide !== 'CONSTELLATION' ||
    submission.constellationSubmitted ||
    !engaged ||
    pair.constellation.control === 'AUTO';
  const locked = mySide === null || !engaged;
  const mySubmitted =
    mySide === 'HUNTER'
      ? submission.hunterSubmitted
      : mySide === 'CONSTELLATION'
        ? submission.constellationSubmitted
        : false;
  const partnerSide: ActorSide | null =
    mySide === 'HUNTER' ? 'CONSTELLATION' : mySide === 'CONSTELLATION' ? 'HUNTER' : null;
  const partnerReady = partnerSide ? sideReady(pair, partnerSide) : false;

  const hunterAction = resolveActionFor(pair, 'HUNTER', submission.hunterActionId);
  const constellationAction = resolveActionFor(
    pair,
    'CONSTELLATION',
    submission.constellationActionId,
  );
  const comboPreview = previewCombo(hunterAction, constellationAction, target?.statuses ?? []);
  const supportPair =
    battle.pairs.find((row) => row.id === submission.supportTargetPairId) ?? null;
  const needsSupportTarget =
    hunterAction?.kind === 'RESCUE' ||
    hunterAction?.kind === 'PROTECT' ||
    // 되살리는 아이템은 대상 페어를 지정해야 한다
    (hunterAction?.kind === 'ITEM' &&
      findItemDefinition(submission.hunterItemId)?.target === 'ALLY');

  // 아이템 행동은 무엇을 쓸지 고르기 전에는 확정할 수 없다
  const itemReady = (side: ActorSide, action: ActionDefinition | null): boolean => {
    if (action?.kind !== 'ITEM') return true;
    return itemAvailability(
      pair,
      side,
      submittedItemId(pair, side),
      Boolean(target),
      supportPair,
    ).usable;
  };

  // 기믹 — 파악(INSIGHT) → 해결(RESOLVE)
  const gimmickStage = availableStage(battle.gimmick, pair);
  const isGimmickAction = hunterAction?.kind === 'GIMMICK';
  /** 지금 화면에 적혀 있는 선언 — 접근 인정 여부를 실시간으로 보여 주려고 계획에 함께 넘긴다 */
  const gimmickNote = gimmickDraft || submission.gimmickNote || '';
  const gimmickPlan =
    battle.gimmick && gimmickStage
      ? planCheck(
          gimmickStage,
          battle.gimmick,
          pair.hunter.stats,
          pair.constellation.stats,
          gimmickNote,
        )
      : null;
  const gimmickNoteOk = declarationValid(gimmickDraft || submission.gimmickNote);
  const downPairs = battle.pairs.filter((row) => row.hunter.hp <= 0);

  const readiness = battle.pairs.map((candidate) => {
    if (candidate.hunter.hp <= 0) return { pair: candidate, state: 'DOWN' as const };
    if (pairReady(candidate)) return { pair: candidate, state: 'READY' as const };
    if (candidate.hunter.control === 'AUTO' || candidate.constellation.control === 'AUTO') {
      return { pair: candidate, state: 'AUTO' as const };
    }
    return { pair: candidate, state: 'WAITING' as const };
  });

  const selectAction = (side: ActorSide, actionId: string) => {
    const key = side === 'HUNTER' ? 'hunterActionId' : 'constellationActionId';
    const current = side === 'HUNTER' ? submission.hunterActionId : submission.constellationActionId;
    const next = current === actionId ? null : actionId;
    update(submitPairAction(battle, pair.id, { [key]: next }));
    void pushSide(pair.id, battle.round, side, { actionId: next });

    // 기믹 수행을 고르면 선언칸이 바로 아래에 열린다. 찾아 내려가지 않게 커서까지 옮겨 준다.
    if (side === 'HUNTER' && next && resolveActionFor(pair, 'HUNTER', next)?.kind === 'GIMMICK') {
      window.requestAnimationFrame(() => {
        gimmickBox.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        gimmickBox.current?.focus({ preventScroll: true });
      });
    }
  };

  const selectItem = (side: ActorSide, itemId: string | null) => {
    const key = side === 'HUNTER' ? 'hunterItemId' : 'constellationItemId';
    update(submitPairAction(battle, pair.id, { [key]: itemId }));
    void pushSide(pair.id, battle.round, side, { itemId });
  };

  /**
   * 내 쪽 행동을 확정한다.
   * 기믹 수행이면 선언과 판정을 함께 확정하고, 그 내용을 채팅에 공개한다.
   */
  const confirmMySide = async () => {
    if (!mySide) return;
    let next = battle;

    if (mySide === 'HUNTER' && isGimmickAction && gimmickPlan && battle.gimmick) {
      const check = rollCheck(gimmickPlan);
      const note = (gimmickDraft || submission.gimmickNote || '').trim();

      next = submitPairAction(next, pair.id, {
        gimmickNote: note,
        gimmickStage: gimmickPlan.stage,
        gimmickCheck: check,
      });

      // 선언과 판정은 모두가 보는 채널에 남는다
      try {
        await storage.postMessage({
          id: newUuid(),
          channel: battle.id,
          authorId: account.id,
          authorName: pair.hunter.name,
          role: 'PARTICIPANT',
          side: 'HUNTER',
          kind: 'TALK',
          body: `[${gimmickPlan.stage === 'INSIGHT' ? '기믹 파악' : '기믹 해결'}] ${note}`,
          dice: null,
          at: new Date().toISOString(),
        });

        if (check) {
          await storage.postMessage({
            id: newUuid(),
            channel: battle.id,
            authorId: account.id,
            authorName: pair.hunter.name,
            role: 'PARTICIPANT',
            side: 'HUNTER',
            kind: 'ROLL',
            body: formatDice({
              expression: check.expression,
              count: 1,
              sides: 20,
              modifier: check.bonus,
              rolls: check.rolls,
              total: check.total,
            }),
            dice: {
              expression: check.expression,
              rolls: check.rolls,
              modifier: check.bonus,
              total: check.total,
              dc: check.dc,
              success: check.success,
              label: `${gimmickPlan.stage === 'INSIGHT' ? '파악' : '해결'} · ${check.breakdown.join(' / ')}`,
            },
            at: new Date().toISOString(),
          });
        }
      } catch {
        // 채팅 전송 실패가 행동 확정을 막지는 않는다
      }
    }

    const submitted = submitPairAction(next, pair.id, {
      [mySide === 'HUNTER' ? 'hunterSubmitted' : 'constellationSubmitted']: true,
    });
    update(submitted);

    const pushed = submitted.pairs.find((row) => row.id === pair.id)?.submission;
    await pushSide(pair.id, battle.round, mySide, {
      submitted: true,
      // 선택 시점의 전송이 실패했을 수 있으므로 확정할 때 한 번 더 보낸다
      itemId: pushed ? submittedItemId({ ...pair, submission: pushed }, mySide) : null,
      ...(mySide === 'HUNTER' && pushed
        ? {
            gimmickNote: pushed.gimmickNote,
            gimmickStage: pushed.gimmickStage,
            gimmickCheck: pushed.gimmickCheck,
          }
        : {}),
    });
    setGimmickDraft('');
  };

  const toggleControl = (side: ActorSide) => {
    const currentMode = side === 'HUNTER' ? pair.hunter.control : pair.constellation.control;
    update(setControlMode(battle, pair.id, side, currentMode === 'AUTO' ? 'ACTIVE' : 'AUTO'));
  };

  // 내 쪽 행동만 고르면 확정할 수 있다. 상대는 상대 단말에서 제출한다.
  const myAction = mySide === 'HUNTER' ? hunterAction : mySide === 'CONSTELLATION' ? constellationAction : null;
  const myActionChosen =
    mySide === 'HUNTER'
      ? Boolean(submission.hunterActionId)
      : mySide === 'CONSTELLATION'
        ? Boolean(submission.constellationActionId)
        : false;
  const canConfirm =
    mySide !== null &&
    engaged &&
    !mySubmitted &&
    myActionChosen &&
    !(mySide === 'HUNTER' && isDown(pair.hunter)) &&
    // 기믹 수행은 선언을 적어야 확정할 수 있다
    !(mySide === 'HUNTER' && isGimmickAction && !gimmickNoteOk) &&
    itemReady(mySide === 'HUNTER' ? 'HUNTER' : 'CONSTELLATION', myAction);

  const visibleAlerts = battle.alerts.filter((item) => !dismissedAlerts.includes(item.id));
  const myPairLabel =
    battle.pairs.find(
      (row) =>
        row.hunterAccountId === account.id || row.constellationAccountId === account.id,
    )?.label ?? null;
  /** AUTO 위임은 전투 상태 변경이다 — 서버 모드에서는 관리국만 바꿀 수 있다 */
  const controlLocked = Boolean(serverStorage);

  const statusLabel: Record<BattleState['status'], string> = {
    PREPARING: '준비',
    ENGAGED: '교전 중',
    CLEARED: '클리어',
    FAILED: '실패',
  };

  /**
   * 지금 무엇을 해야 하는지 한 줄로 알려 준다.
   * 참가자는 이 화면을 처음 보는 사람일 수 있다.
   */
  const guidance: { tone: 'ok' | 'warn' | 'dim'; text: string } = !engaged
    ? { tone: 'dim', text: `전투가 종료되었습니다 — ${statusLabel[battle.status]}` }
    : mySide === null
      ? { tone: 'dim', text: '이 페어의 참가자가 아닙니다 — 조회만 할 수 있습니다.' }
      : mySide === 'HUNTER' && isDown(pair.hunter)
        ? { tone: 'warn', text: '전투 불능 상태입니다 — 다른 페어의 구조를 기다립니다.' }
        : mySubmitted
          ? {
              tone: 'ok',
              text: partnerReady
                ? '양쪽 제출 완료 — 관리국이 라운드를 처리하면 결과가 자동으로 보입니다.'
                : `제출 완료 — ${partnerSide === 'HUNTER' ? '헌터' : '성좌'} 의 제출을 기다립니다.`,
            }
          : {
              tone: 'warn',
              text:
                mySide === 'HUNTER'
                  ? `${pair.hunter.name} (헌터) 의 행동을 고르고 아래 확정 버튼을 누르세요.`
                  : `${pair.constellation.name} (성좌) 의 권능을 고르고 아래 확정 버튼을 누르세요.`,
            };

  return (
    <div className="console">
      <TerminalNav
        current="battle"
        who={{ name: account.sheet.name, side: account.sheet.side }}
      />

      {/* ── 경보 ── */}
      {visibleAlerts.length > 0 && (
        <section className="alert-stack">
          {visibleAlerts
            .slice(-3)
            .reverse()
            .map((item) => (
              <div key={item.id} className={`alert level-${item.level.toLowerCase()}`}>
                <div>
                  <b>{item.title}</b>
                  <span>{item.message}</span>
                </div>
                <button
                  type="button"
                  className="ctl small"
                  onClick={() => setDismissedAlerts((current) => [...current, item.id])}
                >
                  닫기
                </button>
              </div>
            ))}
        </section>
      )}

      {syncError && (
        <p className="notice error">
          {syncError}
          <button type="button" className="ctl small" onClick={() => setSyncError(null)}>
            닫기
          </button>
        </p>
      )}

      {/* ── 헤더 ── */}
      <header className="console-head">
        <div className="agency">
          <b>HUNTER MANAGEMENT AGENCY</b>
          <span>TOWER RAID CONTROL SYSTEM</span>
        </div>
        <dl className="ops">
          <Field label="작전">{battle.operation.name}</Field>
          <Field label="층">{String(battle.operation.floor).padStart(2, '0')}</Field>
          <Field label="라운드">{String(battle.round).padStart(2, '0')}</Field>
          <Field label="위협도">{battle.operation.threatLevel}</Field>
          <Field label="상태">
            <span className={`tag ${battle.status === 'ENGAGED' ? 'ok' : 'warn'}`}>
              {statusLabel[battle.status]}
            </span>
          </Field>
        </dl>
      </header>

      {/* ── 지금 할 일 ── */}
      <p className={`guide-bar tone-${guidance.tone}`}>
        <span className="field-label">지금</span>
        <b>{guidance.text}</b>
      </p>

      {/* ── 단말 정보 ── */}
      <section className="panel session">
        <div className="session-row">
          <span className="field-label">ACCOUNT</span>
          <span className="field-value">{account.id}</span>
          <span className={`tag ${account.sheet.side === 'HUNTER' ? 'blue' : 'gold'}`}>
            {account.sheet.side} · {account.sheet.name}
          </span>
        </div>
        <div className="session-row">
          <span className="field-label">보는 페어</span>
          <select
            className="ctl"
            value={battle.viewerPairId}
            onChange={(event) => update({ ...battle, viewerPairId: event.target.value })}
          >
            {battle.pairs.map((candidate) => {
              const mine =
                candidate.hunterAccountId === account.id ||
                candidate.constellationAccountId === account.id;
              return (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label} · {candidate.hunter.name} / {candidate.constellation.name}
                  {mine ? ' (내 페어)' : ''}
                </option>
              );
            })}
          </select>
          {/* 솔로 테스트로 만든 전투만 여기서 접는다 — 배정된 전투는 관리국이 관리한다 */}
          {!serverStorage && (
            <button type="button" className="ctl small" onClick={() => setBattle(null)}>
              전투 닫기
            </button>
          )}
          <span className="hint">
            {myPairLabel ? `${myPairLabel} 이 본인 페어입니다.` : '이 전투에 배정되지 않았습니다.'}
          </span>
        </div>
      </section>

      {/* ── 기믹 ── */}
      {battle.gimmick && (
        <section className={`panel gimmick status-${battle.gimmick.status.toLowerCase()}`}>
          <div className="process-head">
            <h2 className="panel-title">FLOOR GIMMICK</h2>
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
          </div>
          <Field label="DEVICE">
            {battle.gimmick.label} <small className="dim">{battle.gimmick.labelKo}</small>
          </Field>
          <Gauge
            value={battle.gimmick.progress}
            max={battle.gimmick.required}
            tone={battle.gimmick.status === 'FAILED' ? 'critical' : 'warn'}
          />
          <div className="target-meta">
            <span className="num">
              PROGRESS {battle.gimmick.progress} / {battle.gimmick.required}
            </span>
            <span className="num">
              {battle.gimmick.roundsLeft === null
                ? 'NO TIME LIMIT'
                : `${battle.gimmick.roundsLeft} ROUNDS LEFT`}
            </span>
          </div>
          <div className="target-status">
            <span className="field-label">파악</span>
            {battle.gimmick.identified ? (
              <span className="tag ok">완료 · {battle.gimmick.identifiedBy.join(', ')}</span>
            ) : (
              <span className="tag warn">미파악 — 먼저 장치를 파악해야 합니다</span>
            )}
          </div>
          <p className="hint">{gimmickBrief(battle.gimmick).text}</p>
        </section>
      )}

      {/* ── 타깃 ── */}
      <section className="panel targets">
        <h2 className="panel-title">적 · TARGET</h2>
        <div className="target-grid">
          {battle.enemies.map((enemy) => {
            const dead = enemy.hp <= 0;
            const selected = submission.targetEnemyId === enemy.id;
            return (
              <article
                key={enemy.id}
                className={['target', enemy.boss ? 'boss' : '', dead ? 'dead' : '', selected ? 'aim' : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className="target-head">
                  <span className="grade">{enemy.grade}</span>
                  <b>{enemy.name}</b>
                </div>
                <Gauge
                  value={enemy.hp}
                  max={enemy.maxHp}
                  tone={dead ? 'offline' : enemy.hp / enemy.maxHp < 0.3 ? 'critical' : 'danger'}
                />
                <div className="target-meta">
                  <span className="num">
                    {enemy.hp} / {enemy.maxHp}
                  </span>
                  <span>
                    PHASE {enemy.phase} / {enemy.maxPhase}
                  </span>
                </div>
                <div className="target-status">
                  <span className="field-label">DEF</span>
                  <span className="num">{enemy.defense}</span>
                  <span className="field-label">ATK</span>
                  <span className="num">{enemy.attack}</span>
                </div>
                <div className="target-status">
                  <span className="field-label">STATUS</span>
                  <StatusChips statuses={enemy.statuses} />
                </div>
                <div className="target-status">
                  <span className="field-label">NEXT PATTERN</span>
                  <span className={pair.patternRevealed ? 'gold' : 'dim'}>
                    {pair.patternRevealed ? enemy.nextPattern : 'UNKNOWN'}
                  </span>
                </div>
                {enemy.telegraph && (
                  <p className="telegraph">
                    <b>{enemy.telegraph.label}</b>
                    <span>{enemy.telegraph.message}</span>
                    <small>{Math.max(0, enemy.telegraph.roundsLeft)} ROUNDS UNTIL ACTIVATION</small>
                  </p>
                )}
                {/* 공격 대상은 헌터가 지정한다 */}
                {!dead && battle.enemies.length > 1 && (
                  <button
                    type="button"
                    className="ctl small"
                    disabled={hunterLocked}
                    title={mySide === 'CONSTELLATION' ? '대상 지정은 헌터가 합니다.' : undefined}
                    onClick={() => {
                      update(submitPairAction(battle, pair.id, { targetEnemyId: enemy.id }));
                      void pushSide(pair.id, battle.round, 'HUNTER', { targetEnemyId: enemy.id });
                    }}
                  >
                    {selected ? 'TARGET LOCKED' : 'SET TARGET'}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {/* ── 페어 ── */}
      <section className="pair-grid">
        {/* 헌터 */}
        <article className="panel actor hunter">
          <header className="actor-head">
            <Portrait
              src={portraits[pair.hunterAccountId ?? '']}
              name={pair.hunter.name}
              size="md"
            />
            <div>
              <span className="field-label">HUNTER</span>
              <b>{pair.hunter.name}</b>
              <small className="dim">
                {hunterClass ? `${hunterClass.label} · ${hunterClass.labelKo}` : 'NO CLASS'}
              </small>
            </div>
            <button
              type="button"
              className={`ctl small ${pair.hunter.control === 'AUTO' ? 'on' : ''}`}
              disabled={controlLocked}
              onClick={() => toggleControl('HUNTER')}
              title={
                controlLocked
                  ? 'AUTO 위임은 관리국이 설정합니다. 자리를 비울 때는 채널에 알려 주세요.'
                  : '참가자가 자리를 비우면 자동 행동에 위임합니다.'
              }
            >
              {pair.hunter.control === 'AUTO' ? 'AUTO ON' : 'AUTO OFF'}
            </button>
          </header>

          <Field label="STATUS">
            <span className={`tag ${injury.tone}`}>{injury.label}</span>
            <small className="dim"> {injury.labelKo}</small>
          </Field>
          <Gauge value={pair.hunter.hp} max={pair.hunter.maxHp} tone={injury.tone} />
          <div className="actor-meta">
            <span className="num">
              {pair.hunter.hp} / {pair.hunter.maxHp}
            </span>
            <span>
              <ApDots current={pair.hunter.ap} max={pair.hunter.maxAp} />
              <small className="num">
                {' '}
                {pair.hunter.ap} / {pair.hunter.maxAp}
              </small>
            </span>
          </div>
          <div className="actor-stats">
            <span>
              <span className="field-label">ATK</span> <b className="num">{pair.hunter.attack}</b>
            </span>
            <span>
              <span className="field-label">DEF</span> <b className="num">{pair.hunter.defense}</b>
            </span>
          </div>
          <div className="target-status">
            <span className="field-label">EFFECT</span>
            <StatusChips statuses={pair.hunter.statuses} />
          </div>
          {describeTraits(hunterClass?.traits).length > 0 && (
            <div className="target-status">
              <span className="field-label">CLASS</span>
              {describeTraits(hunterClass?.traits).map((line) => (
                <span key={line} className="tag ok">
                  {line}
                </span>
              ))}
            </div>
          )}

          <h3 className="sub-title">행동 선택 · ACTION</h3>
          <ActionList
            actions={actionsFor(pair, 'HUNTER')}
            pair={pair}
            side="HUNTER"
            target={target}
            selectedId={submission.hunterActionId}
            locked={hunterLocked}
            gimmick={battle.gimmick}
            onSelect={(id) => selectAction('HUNTER', id)}
          />

          {hunterAction?.kind === 'ITEM' && (
            <>
              <h3 className="sub-title">아이템 선택 · ITEM</h3>
              <ItemPicker
                pair={pair}
                side="HUNTER"
                hasTarget={Boolean(target)}
                supportPair={supportPair}
                selectedId={submission.hunterItemId}
                locked={hunterLocked}
                onSelect={(id) => selectItem('HUNTER', id)}
              />
            </>
          )}

          {needsSupportTarget && (
            <div className="input-row" style={{ marginTop: 12 }}>
              <span className="field-label">
                {hunterAction?.kind === 'RESCUE' ? 'RESCUE TARGET' : 'PROTECT TARGET'}
              </span>
              <select
                className="ctl"
                disabled={hunterLocked}
                value={submission.supportTargetPairId ?? ''}
                onChange={(event) => {
                  const value = event.target.value || null;
                  update(submitPairAction(battle, pair.id, { supportTargetPairId: value }));
                  void pushSide(pair.id, battle.round, 'HUNTER', { supportTargetPairId: value });
                }}
              >
                <option value="">자동 선택</option>
                {(hunterAction?.kind === 'RESCUE' ? downPairs : battle.pairs).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.label} · {row.hunter.name}
                    {row.hunter.hp <= 0 ? ' (DOWN)' : ''}
                  </option>
                ))}
              </select>
              {hunterAction?.kind === 'RESCUE' && downPairs.length === 0 && (
                <span className="hint">구조 대상이 없습니다.</span>
              )}
            </div>
          )}
        </article>

        {/* 계약 / 연계 */}
        <article className="panel link">
          <h2 className="panel-title">CONTRACT LINK</h2>
          <div className="link-stage">
            <span className={`tag ${contract.tone}`}>{contract.label}</span>
            <small className="dim">{contract.labelKo}</small>
          </div>
          <Gauge value={pair.contract.value} max={100} tone={contract.tone} />
          <div className="link-wire" aria-hidden="true">
            <span>HUNTER</span>
            <i />
            <span>CONSTELLATION</span>
          </div>

          <h3 className="sub-title">PAIR LINK ANALYSIS</h3>
          <div className="analysis">
            <div className="analysis-row">
              <span className="field-label">HUNTER</span>
              <span>{hunterAction?.label ?? '—'}</span>
            </div>
            <div className="analysis-row">
              <span className="field-label">CONSTELLATION</span>
              <span>{constellationAction?.label ?? '—'}</span>
            </div>

            {comboPreview ? (
              <div className="analysis-result combo">
                <b>COMBINATION AVAILABLE</b>
                <span className="combo-name">《 {comboPreview.definition.label} 》</span>
                <small className="dim">{comboPreview.definition.description}</small>
                <ul className="combo-effects">
                  {comboPreview.view.effects.map((effect) => (
                    <li key={effect}>{effect}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="analysis-result dim">
                NO COMBINATION
                <small>
                  {hunterAction && constellationAction
                    ? '이 조합에서는 연계가 발생하지 않습니다.'
                    : '양쪽 행동을 선택하면 연계를 판정합니다.'}
                </small>
              </p>
            )}
          </div>

          <h3 className="sub-title">RESOURCE · 개인 소지</h3>
          <Field label="헌터 소지금">
            <span className="num gold">{pair.hunter.points ?? 0} P</span>
          </Field>
          <Field label="성좌 소지금">
            <span className="num gold">{pair.constellation.points ?? 0} P</span>
          </Field>
          <Field label="AFFILIATION">
            <span className={`tag ${pair.affiliation === 'GOVERNMENT' ? 'blue' : 'gold'}`}>
              {pair.affiliation === 'GOVERNMENT' ? 'GOVERNMENT' : 'PRIVATE GUILD'}
            </span>
          </Field>
          <p className="hint">
            소지금과 가방은 <b>각자의 것</b>입니다 — 페어와 나누지 않고, 상대의 가방에서 꺼내 쓸
            수 없습니다. 포인트는 보급 창구에서만 씁니다.
          </p>

          <h3 className="sub-title">SUPPLY · 헌터 가방</h3>
          <InventoryList pair={pair} side="HUNTER" />

          <h3 className="sub-title">SUPPLY · 성좌 가방</h3>
          <InventoryList pair={pair} side="CONSTELLATION" />

          {battle.rewards.filter((row) => row.pairId === pair.id).length > 0 && (
            <>
              <h3 className="sub-title">POINT LEDGER</h3>
              <ul className="inventory-list">
                {battle.rewards
                  .filter((row) => row.pairId === pair.id)
                  .slice(-6)
                  .map((row) => (
                    <li key={row.id}>
                      <span>R{row.round}</span>
                      <span>{row.label}</span>
                      <b className="num gold">+{row.points}</b>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </article>

        {/* 성좌 */}
        <article className="panel actor constellation">
          <header className="actor-head">
            <Portrait
              src={portraits[pair.constellationAccountId ?? '']}
              name={pair.constellation.name}
              size="md"
            />
            <div>
              <span className="field-label">CONSTELLATION</span>
              <b>{pair.constellation.name}</b>
              <small className="dim">
                {constellationClass
                  ? `${constellationClass.label} · ${constellationClass.labelKo}`
                  : 'NO DOMAIN'}
              </small>
            </div>
            <button
              type="button"
              className={`ctl small ${pair.constellation.control === 'AUTO' ? 'on' : ''}`}
              disabled={controlLocked}
              onClick={() => toggleControl('CONSTELLATION')}
              title={
                controlLocked
                  ? 'AUTO 위임은 관리국이 설정합니다. 자리를 비울 때는 채널에 알려 주세요.'
                  : '참가자가 자리를 비우면 자동 행동에 위임합니다.'
              }
            >
              {pair.constellation.control === 'AUTO' ? 'AUTO ON' : 'AUTO OFF'}
            </button>
          </header>

          <Field label="EXISTENCE">
            <span className={`tag ${constellation.tone}`}>{constellation.label}</span>
            <small className="dim"> {constellation.labelKo}</small>
          </Field>
          <div className="measure" aria-hidden="true">
            <span className="field-label">OUTPUT</span>
            <span className="measure-bar">■■■■■■■■■■■■</span>
            <small className="warn-text">MEASUREMENT ERROR</small>
          </div>
          <div className="actor-meta">
            <span />
            <span>
              <ApDots current={pair.constellation.ap} max={pair.constellation.maxAp} />
              <small className="num">
                {' '}
                {pair.constellation.ap} / {pair.constellation.maxAp}
              </small>
            </span>
          </div>
          <div className="actor-stats">
            <span>
              <span className="field-label">POWER</span>{' '}
              <b className="num gold">×{pair.constellation.power}</b>
            </span>
            <span>
              <span className="field-label">MANIFEST</span>{' '}
              <b className="num">
                {pair.constellation.manifestUses.partial ?? '∞'} /{' '}
                {pair.constellation.manifestUses.full ?? '∞'}
              </b>
            </span>
          </div>
          <div className="target-status">
            <span className="field-label">EFFECT</span>
            <StatusChips statuses={pair.constellation.statuses} />
          </div>
          {describeTraits(constellationClass?.traits).length > 0 && (
            <div className="target-status">
              <span className="field-label">DOMAIN</span>
              {describeTraits(constellationClass?.traits).map((line) => (
                <span key={line} className="tag ok">
                  {line}
                </span>
              ))}
            </div>
          )}

          <h3 className="sub-title">권능 선택 · AUTHORITY</h3>
          <ActionList
            actions={actionsFor(pair, 'CONSTELLATION')}
            pair={pair}
            side="CONSTELLATION"
            target={target}
            selectedId={submission.constellationActionId}
            locked={constellationLocked}
            gimmick={battle.gimmick}
            onSelect={(id) => selectAction('CONSTELLATION', id)}
          />

          {constellationAction?.kind === 'ITEM' && (
            <>
              <h3 className="sub-title">성유물 선택 · RELIC</h3>
              <ItemPicker
                pair={pair}
                side="CONSTELLATION"
                hasTarget={Boolean(target)}
                supportPair={supportPair}
                selectedId={submission.constellationItemId}
                locked={constellationLocked}
                onSelect={(id) => selectItem('CONSTELLATION', id)}
              />
            </>
          )}
        </article>
      </section>

      {/* ── 기믹 선언 ── 확정 버튼 바로 위에 둔다. 행동을 고른 자리에서 그대로 이어 쓰게 된다 ── */}
      {battle.gimmick && isGimmickAction && mySide === 'HUNTER' && !mySubmitted && (
        <section className="panel gimmick-declare">
          <div className="process-head">
            <h2 className="panel-title">
              기믹 {gimmickStage === 'INSIGHT' ? '파악' : '해결'} 선언
            </h2>
            <span className="hint">선언과 판정 결과는 채널에 공개되고, 관리국이 최종 인정합니다.</span>
          </div>

          <p className="gimmick-brief">{gimmickBrief(battle.gimmick).text}</p>

          {gimmickStage === 'INSIGHT' ? (
            <p className="hint">
              아직 장치를 파악하지 못했습니다. 무엇을 어떻게 관찰하는지 적으세요 —
              <b> 관찰력</b>과 성좌의 <b>관측</b>이 판정에 붙습니다.
            </p>
          ) : (
            <p className="hint">
              장치는 파악되었습니다. 어떻게 처리할지 적으세요 — <b>운</b>과 <b>관찰력</b>이 판정에
              붙습니다.
            </p>
          )}

          {/*
             무엇을 해야 풀리는지 미리 밝힌다.
             파악 전에는 방법 이름만, 파악한 뒤에는 구체적인 지시까지 보여 준다.
          */}
          {gimmickPlan && gimmickPlan.approaches.length > 0 && (
            <div className="approach-list">
              <span className="field-label">
                인정되는 접근 {gimmickStage === 'INSIGHT' ? '· 파악' : '· 해결'}
              </span>
              {gimmickPlan.approaches.map((row) => {
                const on = gimmickPlan.matched?.id === row.id;
                return (
                  <div key={row.id} className={`approach ${on ? 'on' : ''}`}>
                    <b>
                      {on ? '▸ ' : ''}
                      {row.label}
                    </b>
                    <span className="tag">+{row.bonus}</span>
                    {battle.gimmick?.identified && <small className="dim">{row.detail}</small>}
                  </div>
                );
              })}
              <p className={`hint ${gimmickPlan.offApproach ? 'warn-text' : 'dim'}`}>
                {gimmickPlan.matched
                  ? `「${gimmickPlan.matched.label}」 로 인정됩니다 (+${gimmickPlan.matched.bonus}).`
                  : gimmickPlan.offApproach
                    ? '위 방법 중 어느 것도 아닙니다 — 굴릴 수는 있지만 판정이 크게 불리해집니다.'
                    : '위 방법 중 하나에 맞춰 적으면 판정에 보정이 붙습니다.'}
              </p>
            </div>
          )}

          {gimmickPlan && (
            <div className="check-preview">
              <span className="field-label">판정</span>
              <b className="num">1d20 + {gimmickPlan.bonus}</b>
              <span className="dim">vs 목표 {gimmickPlan.dc}</span>
              {gimmickPlan.breakdown.map((line) => (
                <span key={line} className="tag">
                  {line}
                </span>
              ))}
            </div>
          )}

          <textarea
            ref={gimmickBox}
            className="ctl input textarea"
            rows={3}
            value={gimmickDraft || submission.gimmickNote || ''}
            placeholder={
              gimmickStage === 'INSIGHT'
                ? '예: 문양의 홈을 따라 손끝으로 훑으며 반복되는 배열을 찾는다'
                : '예: 파악한 순서대로 고정점을 검으로 끊어낸다'
            }
            onChange={(event) => setGimmickDraft(event.target.value)}
          />
          <p className={`hint ${gimmickNoteOk ? 'ok-text' : 'warn-text'}`}>
            {gimmickNoteOk
              ? '확정하면 판정이 굴러갑니다.'
              : '최소 8자 이상 서술해야 확정할 수 있습니다.'}
          </p>
        </section>
      )}

      {/* ── 행동 확정 ── */}
      {/* dock — 페어 그리드 아래라 매 라운드 오르내리게 된다. 화면 아래에 붙여 둔다. */}
      <section className="panel confirm dock">
        <div className="dock-jump">
          <button
            type="button"
            className="ctl small"
            onClick={() => chatBox.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            작전 채널 ↓
          </button>
        </div>
        {!engaged ? (
          <p className="confirm-note">
            {battle.status === 'CLEARED' ? '작전 클리어' : '작전 실패'}
            <small>관리국이 다음 전투를 편성하면 이 화면이 바뀝니다.</small>
          </p>
        ) : mySide === null ? (
          <p className="confirm-note">
            조회 전용
            <small>내 페어가 아닙니다 — 다른 페어의 행동은 조작할 수 없습니다.</small>
          </p>
        ) : mySubmitted ? (
          <div className="confirm-done">
            <p>
              제출 완료
              <small>
                {partnerReady
                  ? '관리국의 라운드 처리를 기다립니다…'
                  : `${partnerSide === 'HUNTER' ? '헌터' : '성좌'} 제출 대기 중…`}
              </small>
            </p>
            {UI_RULES.allowCancelAfterSubmit && (
              <button
                type="button"
                className="ctl"
                onClick={() => {
                  update(
                    submitPairAction(battle, pair.id, {
                      [mySide === 'HUNTER' ? 'hunterSubmitted' : 'constellationSubmitted']: false,
                    }),
                  );
                  void pushSide(pair.id, battle.round, mySide, { submitted: false });
                }}
              >
                제출 취소
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="confirm-btn"
            disabled={!canConfirm}
            onClick={() => void confirmMySide()}
          >
            {mySide === 'HUNTER' ? '헌터 행동 확정' : '성좌 권능 확정'}
            {!canConfirm && (
              <small>
                {mySide === 'HUNTER' && isDown(pair.hunter)
                  ? '헌터 전투 불능 — 다른 페어의 구조를 기다립니다'
                  : mySide === 'HUNTER' && isGimmickAction && !gimmickNoteOk
                    ? '기믹 선언을 8자 이상 적어야 확정할 수 있습니다'
                    : '위에서 내 쪽 행동을 먼저 고르세요'}
              </small>
            )}
          </button>
        )}
      </section>

      {/* ── 같이 싸우는 사람 ── */}
      <section className="panel">
        <div className="process-head">
          <h2 className="panel-title">같이 싸우는 사람</h2>
          <span className="hint">
            연계를 맞추려면 상대가 무엇을 할 수 있는지 알아야 합니다. 스탯과 스킬은 전투에 들어간
            값입니다.
          </span>
        </div>
        <div className="sheet-list">
          <ActorSheet
            side="HUNTER"
            name={pair.hunter.name}
            classId={pair.hunter.classId}
            stats={pair.hunter.stats}
            skills={pair.hunter.skills}
            accountId={pair.hunterAccountId}
            portrait={portraits[pair.hunterAccountId ?? '']}
            badge={
              mySide === 'HUNTER' ? <span className="tag blue">내 캐릭터</span> : undefined
            }
          />
          <ActorSheet
            side="CONSTELLATION"
            name={pair.constellation.name}
            classId={pair.constellation.classId}
            stats={pair.constellation.stats}
            skills={pair.constellation.skills}
            accountId={pair.constellationAccountId}
            portrait={portraits[pair.constellationAccountId ?? '']}
            badge={
              mySide === 'CONSTELLATION' ? <span className="tag gold">내 캐릭터</span> : undefined
            }
          />
        </div>

        {battle.pairs.length > 1 && (
          <Collapsible label={`다른 공략조 ${battle.pairs.length - 1}`}>
            <div className="sheet-list">
              {battle.pairs
                .filter((row) => row.id !== pair.id)
                .flatMap((row) => [
                  <ActorSheet
                    key={`${row.id}-h`}
                    side="HUNTER"
                    name={row.hunter.name}
                    classId={row.hunter.classId}
                    stats={row.hunter.stats}
                    skills={row.hunter.skills}
                    portrait={portraits[row.hunterAccountId ?? '']}
                    badge={<span className="tag">{row.label}</span>}
                  />,
                  <ActorSheet
                    key={`${row.id}-c`}
                    side="CONSTELLATION"
                    name={row.constellation.name}
                    classId={row.constellation.classId}
                    stats={row.constellation.stats}
                    skills={row.constellation.skills}
                    portrait={portraits[row.constellationAccountId ?? '']}
                    badge={<span className="tag">{row.label}</span>}
                  />,
                ])}
            </div>
          </Collapsible>
        )}
      </section>

      {/* ── 페어 모니터 (레이드) ── */}
      {battle.pairs.length > 1 && (
        <section className="panel roster">
          <h2 className="panel-title">RAID ROSTER</h2>
          <div className="roster-grid">
            {readiness.map(({ pair: row, state }) => {
              const rowInjury = injuryOf(row.hunter);
              return (
                <button
                  key={row.id}
                  type="button"
                  className={`roster-card ${row.id === battle.viewerPairId ? 'current' : ''}`}
                  onClick={() => update({ ...battle, viewerPairId: row.id })}
                >
                  <div className="roster-head">
                    <b>{row.label}</b>
                    <span
                      className={`tag ${
                        state === 'WAITING' ? 'warn' : state === 'DOWN' ? 'offline' : 'ok'
                      }`}
                    >
                      {state}
                    </span>
                  </div>
                  <span className="dim">
                    {row.hunter.name} / {row.constellation.name}
                  </span>
                  <div className="roster-meta">
                    <span className={`tag ${rowInjury.tone}`}>{rowInjury.label}</span>
                    <span className="num">
                      HP {Math.round((row.hunter.hp / row.hunter.maxHp) * 100)}%
                    </span>
                    <span className="num">
                      AP {row.hunter.ap}/{row.constellation.ap}
                    </span>
                  </div>
                  <div className="roster-meta">
                    <StatusChips statuses={row.hunter.statuses} />
                  </div>
                  {(row.hunter.control === 'AUTO' || row.constellation.control === 'AUTO') && (
                    <span className="tag auto">
                      AUTO{' '}
                      {[
                        row.hunter.control === 'AUTO' ? 'H' : null,
                        row.constellation.control === 'AUTO' ? 'C' : null,
                      ]
                        .filter(Boolean)
                        .join('+')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ── 제출 현황 ── */}
      <section className="panel process">
        <div className="process-head">
          <h2 className="panel-title">제출 현황</h2>
          <span className="hint">라운드 처리는 관리국(운영진) 화면에서 진행됩니다.</span>
        </div>
        <div className="submit-status">
          <div className={`submit-side ${sideReady(pair, 'HUNTER') ? 'ready' : ''}`}>
            <span className="field-label">HUNTER</span>
            <b>{pair.hunter.name}</b>
            <span className={`tag ${sideReady(pair, 'HUNTER') ? 'ok' : 'warn'}`}>
              {pair.hunter.control === 'AUTO'
                ? 'AUTO'
                : submission.hunterSubmitted
                  ? 'READY'
                  : 'WAITING'}
            </span>
            {mySide === 'HUNTER' && <span className="tag blue">MY TERMINAL</span>}
          </div>
          <div className={`submit-side ${sideReady(pair, 'CONSTELLATION') ? 'ready' : ''}`}>
            <span className="field-label">CONSTELLATION</span>
            <b>{pair.constellation.name}</b>
            <span className={`tag ${sideReady(pair, 'CONSTELLATION') ? 'ok' : 'warn'}`}>
              {pair.constellation.control === 'AUTO'
                ? 'AUTO'
                : submission.constellationSubmitted
                  ? 'READY'
                  : 'WAITING'}
            </span>
            {mySide === 'CONSTELLATION' && <span className="tag gold">MY TERMINAL</span>}
          </div>
        </div>
        <p className="hint">
          {controlLocked
            ? '상대가 자리를 비웠다면 채널로 관리국에 알려 주세요. AUTO 위임은 관리국이 설정합니다.'
            : '상대가 자리를 비웠다면 해당 쪽의 AUTO 를 켜서 자동 행동으로 진행할 수 있습니다.'}
        </p>
      </section>

      {/* ── 채팅 ── */}
      <div ref={chatBox}>
        <ChatPanel
          channel={battle.id}
          title="작전 채널"
          author={{
            id: account.id,
            name: account.sheet.name,
            role: 'PARTICIPANT',
            side: account.sheet.side,
          }}
        />
      </div>

      {/* ── 로그 ── */}
      <section className="panel log">
        <h2 className="panel-title">SYSTEM LOG</h2>
        {battle.log.length === 0 ? (
          <p className="dim">기록이 없습니다.</p>
        ) : (
          <ol className="log-list">
            {[...battle.log]
              .reverse()
              .slice(0, 80)
              .map((entry) => (
                <li key={entry.id}>
                  <span className="log-time num">[{entry.at}]</span>
                  <span className="log-text">
                    {entry.text}
                    {UI_RULES.showLogDetail && entry.detail && (
                      <small className="dim">{entry.detail}</small>
                    )}
                  </span>
                </li>
              ))}
          </ol>
        )}
      </section>
    </div>
  );
}
