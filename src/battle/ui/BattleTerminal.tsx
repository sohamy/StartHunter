/**
 * 참가자 전투 단말.
 *
 * 이 컴포넌트는 전투 규칙을 계산하지 않는다.
 * 모든 판정은 engine/ 에, 모든 수치는 config/ 에 있다.
 *
 * 진입 조건: 계약자 등록(로그인)이 되어 있어야 한다.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { findClass } from '../config/characters';
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
import {
  actionAvailability,
  applyRound,
  dismissAlert,
  previewRound,
  setControlMode,
  submitPairAction,
} from '../engine/round';
import { actionsFor, findSkillRuntime, resolveActionFor } from '../engine/skills';
import {
  constellationView,
  contractView,
  injuryOf,
  isDown,
  statusViews,
} from '../engine/status';
import { getAuth, getStorage, type PublicProfile } from '../store';
import type {
  ActionDefinition,
  Account,
  ActorSide,
  BattleMode,
  BattleState,
  CharacterSheet,
  EnemyState,
  PairState,
  RoundPreview,
  StatusEffect,
} from '../types';

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
  onSelect: (actionId: string) => void;
}

function ActionList({
  actions,
  pair,
  side,
  target,
  selectedId,
  locked,
  onSelect,
}: ActionListProps) {
  return (
    <ul className="action-list">
      {actions.map((action) => {
        const availability = actionAvailability(action, pair, Boolean(target));
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
              <span className="action-cost">AP {action.apCost}</span>
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

/* ── 본체 ──────────────────────────────────────────────── */

export default function BattleTerminal() {
  const storage = useMemo(() => getStorage(), []);
  const auth = useMemo(() => getAuth(), []);

  const [authState, setAuthState] = useState<'LOADING' | 'GUEST' | 'READY'>('LOADING');
  const [account, setAccount] = useState<Account | null>(null);
  const [partners, setPartners] = useState<PublicProfile[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const [setupMode, setSetupMode] = useState<BattleMode>('DUEL');

  const [battle, setBattle] = useState<BattleState | null>(null);
  const [preview, setPreview] = useState<RoundPreview | null>(null);

  const battleId = account ? `BATTLE-${account.id}` : null;

  useEffect(() => {
    let cancelled = false;

    (async () => {
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
      const profiles = (await auth.listProfiles(opposite)).filter(
        (profile) => profile.accountId !== found.id,
      );

      // 운영진이 편성한 전투 중 내 계정이 배정된 것을 찾는다.
      let joined: BattleState | null = null;
      for (const summary of await storage.listBattles()) {
        const candidate = await storage.loadBattle(summary.id);
        if (!candidate) continue;
        const myPair = candidate.pairs.find(
          (row) => row.hunterAccountId === found.id || row.constellationAccountId === found.id,
        );
        if (myPair) {
          joined = { ...candidate, viewerPairId: myPair.id };
          break;
        }
      }

      if (cancelled) return;
      setAccount(found);
      setPartners(profiles);
      setBattle(joined);
      setAuthState('READY');
    })();

    return () => {
      cancelled = true;
    };
  }, [auth, storage]);

  useEffect(() => {
    if (battle) void storage.saveBattle(battle);
  }, [battle, storage]);

  const update = useCallback((next: BattleState) => {
    setBattle(next);
    setPreview(null);
  }, []);

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

    setPreview(null);
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
        <header className="console-head">
          <div className="agency">
            <b>HUNTER MANAGEMENT AGENCY</b>
            <span>TOWER RAID CONTROL SYSTEM</span>
          </div>
          <dl className="ops">
            <Field label="OPERATOR">{account.id}</Field>
            <Field label="ROLE">
              <span className={`tag ${account.sheet.side === 'HUNTER' ? 'blue' : 'gold'}`}>
                {account.sheet.side}
              </span>
            </Field>
            <Field label="NAME">{account.sheet.name}</Field>
          </dl>
        </header>

        <section className="panel">
          <h2 className="panel-title">AWAITING ASSIGNMENT</h2>
          <p>
            {account.sheet.name} · {mySheetClass?.label ?? '—'} 시트로 등록되어 있습니다.
            <br />
            <b>페어 편성은 관리국(운영진)이 진행합니다.</b> 배정이 완료되면 이 화면에서 자동으로
            전투 단말이 열립니다.
          </p>
          <div className="btn-row" style={{ marginTop: 16 }}>
            <button type="button" className="ctl" onClick={() => window.location.reload()}>
              배정 확인 · 새로고침
            </button>
            <a className="ctl small" href={joinUrl()}>
              내 시트 보기
            </a>
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
  const needsSupportTarget =
    hunterAction?.kind === 'RESCUE' || hunterAction?.kind === 'PROTECT';
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
    update(submitPairAction(battle, pair.id, { [key]: current === actionId ? null : actionId }));
  };

  const toggleControl = (side: ActorSide) => {
    const currentMode = side === 'HUNTER' ? pair.hunter.control : pair.constellation.control;
    update(setControlMode(battle, pair.id, side, currentMode === 'AUTO' ? 'ACTIVE' : 'AUTO'));
  };

  // 내 쪽 행동만 고르면 확정할 수 있다. 상대는 상대 단말에서 제출한다.
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
    !(mySide === 'HUNTER' && isDown(pair.hunter));

  const statusLabel: Record<BattleState['status'], string> = {
    PREPARING: 'STANDBY',
    ENGAGED: 'ENGAGED',
    CLEARED: 'CLEARED',
    FAILED: 'FAILED',
  };

  return (
    <div className="console">
      {/* ── 경보 ── */}
      {battle.alerts.length > 0 && (
        <section className="alert-stack">
          {battle.alerts
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
                  onClick={() => setBattle(dismissAlert(battle, item.id))}
                >
                  DISMISS
                </button>
              </div>
            ))}
        </section>
      )}

      {/* ── 헤더 ── */}
      <header className="console-head">
        <div className="agency">
          <b>HUNTER MANAGEMENT AGENCY</b>
          <span>TOWER RAID CONTROL SYSTEM</span>
        </div>
        <dl className="ops">
          <Field label="OPERATION">{battle.operation.name}</Field>
          <Field label="FLOOR">{String(battle.operation.floor).padStart(2, '0')}</Field>
          <Field label="ROUND">{String(battle.round).padStart(2, '0')}</Field>
          <Field label="THREAT">{battle.operation.threatLevel}</Field>
          <Field label="MODE">{battle.mode}</Field>
          <Field label="STATUS">
            <span className={`tag ${battle.status === 'ENGAGED' ? 'ok' : 'warn'}`}>
              {statusLabel[battle.status]}
            </span>
          </Field>
        </dl>
      </header>

      {/* ── 단말 정보 ── */}
      <section className="panel session">
        <div className="session-row">
          <span className="field-label">OPERATOR</span>
          <span className="field-value">{account.id}</span>
          <span className={`tag ${account.sheet.side === 'HUNTER' ? 'blue' : 'gold'}`}>
            {account.sheet.side} · {account.sheet.name}
          </span>
          <a className="ctl small" href={joinUrl()}>
            SHEET
          </a>
        </div>
        <div className="session-row">
          <span className="field-label">TERMINAL</span>
          <select
            className="ctl"
            value={battle.viewerPairId}
            onChange={(event) => update({ ...battle, viewerPairId: event.target.value })}
          >
            {battle.pairs.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label} · {candidate.hunter.name} / {candidate.constellation.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ctl small"
            onClick={() => {
              setBattle(null);
              setPreview(null);
            }}
          >
            RE-DEPLOY
          </button>
          <span className="hint">PAIR 01 이 본인 페어입니다.</span>
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
          <p className="hint">{battle.gimmick.description}</p>
        </section>
      )}

      {/* ── 타깃 ── */}
      <section className="panel targets">
        <h2 className="panel-title">TARGET</h2>
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
                {!dead && battle.enemies.length > 1 && (
                  <button
                    type="button"
                    className="ctl small"
                    disabled={locked}
                    onClick={() =>
                      update(submitPairAction(battle, pair.id, { targetEnemyId: enemy.id }))
                    }
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
              onClick={() => toggleControl('HUNTER')}
              title="참가자가 자리를 비우면 자동 행동에 위임합니다."
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

          <h3 className="sub-title">ACTION</h3>
          <ActionList
            actions={actionsFor(pair, 'HUNTER')}
            pair={pair}
            side="HUNTER"
            target={target}
            selectedId={submission.hunterActionId}
            locked={hunterLocked}
            onSelect={(id) => selectAction('HUNTER', id)}
          />

          {needsSupportTarget && (
            <div className="input-row" style={{ marginTop: 12 }}>
              <span className="field-label">
                {hunterAction?.kind === 'RESCUE' ? 'RESCUE TARGET' : 'PROTECT TARGET'}
              </span>
              <select
                className="ctl"
                disabled={locked}
                value={submission.supportTargetPairId ?? ''}
                onChange={(event) =>
                  update(
                    submitPairAction(battle, pair.id, {
                      supportTargetPairId: event.target.value || null,
                    }),
                  )
                }
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

          <h3 className="sub-title">PAIR RESOURCE</h3>
          <Field label="POINT">
            <span className="num gold">{pair.points} P</span>
          </Field>
          <Field label="AFFILIATION">
            <span className={`tag ${pair.affiliation === 'GOVERNMENT' ? 'blue' : 'gold'}`}>
              {pair.affiliation === 'GOVERNMENT' ? 'GOVERNMENT' : 'PRIVATE GUILD'}
            </span>
          </Field>
        </article>

        {/* 성좌 */}
        <article className="panel actor constellation">
          <header className="actor-head">
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
              onClick={() => toggleControl('CONSTELLATION')}
              title="참가자가 자리를 비우면 자동 행동에 위임합니다."
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

          <h3 className="sub-title">AUTHORITY</h3>
          <ActionList
            actions={actionsFor(pair, 'CONSTELLATION')}
            pair={pair}
            side="CONSTELLATION"
            target={target}
            selectedId={submission.constellationActionId}
            locked={constellationLocked}
            onSelect={(id) => selectAction('CONSTELLATION', id)}
          />
        </article>
      </section>

      {/* ── 행동 확정 ── */}
      <section className="panel confirm">
        {!engaged ? (
          <p className="confirm-note">
            {battle.status === 'CLEARED' ? 'OPERATION CLEARED' : 'OPERATION FAILED'}
            <small>RE-DEPLOY 로 새 전투를 편성할 수 있습니다.</small>
          </p>
        ) : mySide === null ? (
          <p className="confirm-note">
            OBSERVING
            <small>내 페어가 아닙니다 — 조회만 가능합니다.</small>
          </p>
        ) : mySubmitted ? (
          <div className="confirm-done">
            <p>
              ACTION SUBMITTED
              <small>
                {partnerReady
                  ? 'Waiting for Raid Control…'
                  : `${partnerSide === 'HUNTER' ? '헌터' : '성좌'} 제출 대기 중…`}
              </small>
            </p>
            {UI_RULES.allowCancelAfterSubmit && (
              <button
                type="button"
                className="ctl"
                onClick={() =>
                  update(
                    submitPairAction(battle, pair.id, {
                      [mySide === 'HUNTER' ? 'hunterSubmitted' : 'constellationSubmitted']: false,
                    }),
                  )
                }
              >
                CANCEL
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="confirm-btn"
            disabled={!canConfirm}
            onClick={() =>
              update(
                submitPairAction(battle, pair.id, {
                  [mySide === 'HUNTER' ? 'hunterSubmitted' : 'constellationSubmitted']: true,
                }),
              )
            }
          >
            CONFIRM ACTION · {mySide}
            {!canConfirm && (
              <small>
                {mySide === 'HUNTER' && isDown(pair.hunter)
                  ? '헌터 전투 불능 — 다른 페어의 구조를 기다립니다'
                  : '내 쪽 행동을 선택하세요'}
              </small>
            )}
          </button>
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
          <h2 className="panel-title">SUBMISSION STATUS</h2>
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
          상대가 자리를 비웠다면 해당 쪽의 <b>AUTO</b> 를 켜서 자동 행동으로 진행할 수 있습니다.
        </p>
      </section>

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
