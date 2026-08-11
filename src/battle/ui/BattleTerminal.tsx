/**
 * 참가자 전투 단말 (Phase 1).
 *
 * 이 컴포넌트는 전투 규칙을 계산하지 않는다.
 * 모든 판정은 engine/ 에, 모든 수치는 config/ 에 있다.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { CONSTELLATION_ACTIONS, HUNTER_ACTIONS, findAction } from '../config/actions';
import { CURRENT_PHASE, UI_RULES } from '../config/rules';
import { DEFAULT_RAID_PAIR_COUNT } from '../config/scenario';
import { createBattle, resolveTarget, viewerPair } from '../engine/battle';
import {
  actionAvailability,
  applyRound,
  previewRound,
  setControlMode,
  submitPairAction,
} from '../engine/round';
import { constellationView, contractView, injuryOf, isDown } from '../engine/status';
import { getStorage } from '../store';
import type {
  ActionDefinition,
  ActorSide,
  BattleState,
  EnemyState,
  PairState,
  RoundPreview,
} from '../types';

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

function Gauge({
  value,
  max,
  tone = 'ok',
}: {
  value: number;
  max: number;
  tone?: string;
}) {
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

/* ── 행동 목록 ─────────────────────────────────────────── */

interface ActionListProps {
  actions: ActionDefinition[];
  pair: PairState;
  target: EnemyState | null;
  selectedId: string | null;
  locked: boolean;
  onSelect: (actionId: string) => void;
}

function ActionList({ actions, pair, target, selectedId, locked, onSelect }: ActionListProps) {
  return (
    <ul className="action-list">
      {actions.map((action) => {
        const availability = actionAvailability(action, pair, Boolean(target));
        const disabled = locked || !availability.usable;
        const future = action.implementedIn > CURRENT_PHASE;

        return (
          <li key={action.id}>
            <button
              type="button"
              className={[
                'action',
                selectedId === action.id ? 'selected' : '',
                future ? 'future' : '',
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
              {!availability.usable && (
                <span className="action-block">{availability.reason}</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ── 본체 ──────────────────────────────────────────────── */

export default function BattleTerminal() {
  const [battle, setBattle] = useState<BattleState | null>(null);
  const [preview, setPreview] = useState<RoundPreview | null>(null);
  const storage = useMemo(() => getStorage(), []);

  // 최초 진입 — 저장된 전투를 복구하고, 없으면 새로 만든다.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const list = await storage.listBattles();
      const latest = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      const restored = latest ? await storage.loadBattle(latest.id) : null;
      if (cancelled) return;
      setBattle(restored ?? createBattle({ mode: 'DUEL' }));
    })();

    return () => {
      cancelled = true;
    };
  }, [storage]);

  // 상태가 바뀔 때마다 저장한다. 새로고침 후에도 이어서 진행할 수 있어야 한다.
  useEffect(() => {
    if (battle) void storage.saveBattle(battle);
  }, [battle, storage]);

  const update = useCallback((next: BattleState) => {
    setBattle(next);
    setPreview(null);
  }, []);

  const startBattle = useCallback(
    (mode: 'DUEL' | 'RAID') => {
      setPreview(null);
      setBattle(
        createBattle({
          mode,
          pairCount: mode === 'RAID' ? DEFAULT_RAID_PAIR_COUNT : 1,
          monsterCount: mode === 'RAID' ? 1 : 0,
        }),
      );
    },
    [],
  );

  if (!battle) {
    return <div className="console-loading">CONNECTING TO RAID CONTROL…</div>;
  }

  const pair = viewerPair(battle);
  const target = resolveTarget(battle, pair);
  const injury = injuryOf(pair.hunter);
  const constellation = constellationView(pair.constellation.stage);
  const contract = contractView(pair.contract.stage);
  const submission = pair.submission;
  const locked = submission.submitted || battle.status !== 'ENGAGED';

  const readiness = battle.pairs.map((candidate) => {
    if (candidate.hunter.hp <= 0) return { pair: candidate, state: 'DOWN' as const };
    if (candidate.submission.submitted) return { pair: candidate, state: 'READY' as const };
    if (candidate.hunter.control === 'AUTO' && candidate.constellation.control === 'AUTO') {
      return { pair: candidate, state: 'AUTO' as const };
    }
    return { pair: candidate, state: 'WAITING' as const };
  });
  const allReady = readiness.every((row) => row.state !== 'WAITING');

  const selectAction = (side: ActorSide, actionId: string) => {
    const key = side === 'HUNTER' ? 'hunterActionId' : 'constellationActionId';
    const current = side === 'HUNTER' ? submission.hunterActionId : submission.constellationActionId;
    update(submitPairAction(battle, pair.id, { [key]: current === actionId ? null : actionId }));
  };

  const toggleControl = (side: ActorSide) => {
    const currentMode =
      side === 'HUNTER' ? pair.hunter.control : pair.constellation.control;
    update(setControlMode(battle, pair.id, side, currentMode === 'AUTO' ? 'ACTIVE' : 'AUTO'));
  };

  const confirmAction = () => {
    update(submitPairAction(battle, pair.id, { submitted: true }));
  };

  const cancelAction = () => {
    update(submitPairAction(battle, pair.id, { submitted: false }));
  };

  const runPreview = () => {
    setPreview(previewRound(battle));
  };

  const applyPreview = () => {
    if (!preview) return;
    setBattle(applyRound(battle, preview));
    setPreview(null);
  };

  // 자동 위임된 쪽은 참가자가 고르지 않아도 확정할 수 있다.
  // 한쪽이 이탈해도 남은 참가자가 라운드를 계속 진행할 수 있어야 한다.
  const hunterReady = pair.hunter.control === 'AUTO' || Boolean(submission.hunterActionId);
  const constellationReady =
    pair.constellation.control === 'AUTO' || Boolean(submission.constellationActionId);
  const canConfirm = !locked && hunterReady && constellationReady && !isDown(pair.hunter);

  const statusLabel: Record<BattleState['status'], string> = {
    PREPARING: 'STANDBY',
    ENGAGED: 'ENGAGED',
    CLEARED: 'CLEARED',
    FAILED: 'FAILED',
  };

  return (
    <div className="console">
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

      {/* ── 전투 선택 / 단말 설정 ── */}
      <section className="panel session">
        <div className="session-row">
          <span className="field-label">OPERATION PRESET</span>
          <div className="btn-row">
            <button type="button" className="ctl" onClick={() => startBattle('DUEL')}>
              DUEL · 페어 1조
            </button>
            <button type="button" className="ctl" onClick={() => startBattle('RAID')}>
              RAID · {DEFAULT_RAID_PAIR_COUNT}페어
            </button>
          </div>
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
          <span className="hint">
            로그인 기능이 없는 단계이므로 조작할 페어를 직접 선택합니다.
          </span>
        </div>
      </section>

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
                  <span className="field-label">STATUS</span>
                  {enemy.statuses.length === 0 ? (
                    <span className="dim">NONE</span>
                  ) : (
                    enemy.statuses.map((status) => <span key={status} className="tag">{status}</span>)
                  )}
                </div>
                <div className="target-status">
                  <span className="field-label">NEXT PATTERN</span>
                  <span className={pair.patternRevealed ? 'gold' : 'dim'}>
                    {pair.patternRevealed ? enemy.nextPattern : 'UNKNOWN'}
                  </span>
                </div>
                {!dead && battle.enemies.length > 1 && (
                  <button
                    type="button"
                    className="ctl small"
                    disabled={locked}
                    onClick={() => update(submitPairAction(battle, pair.id, { targetEnemyId: enemy.id }))}
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
              <small className="num"> {pair.hunter.ap} / {pair.hunter.maxAp}</small>
            </span>
          </div>

          <h3 className="sub-title">ACTION</h3>
          <ActionList
            actions={HUNTER_ACTIONS}
            pair={pair}
            target={target}
            selectedId={submission.hunterActionId}
            locked={locked || pair.hunter.control === 'AUTO'}
            onSelect={(id) => selectAction('HUNTER', id)}
          />
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
              <span>{findAction(submission.hunterActionId)?.label ?? '—'}</span>
            </div>
            <div className="analysis-row">
              <span className="field-label">CONSTELLATION</span>
              <span>{findAction(submission.constellationActionId)?.label ?? '—'}</span>
            </div>
            <p className="analysis-result dim">
              COMBINATION ANALYSIS OFFLINE
              <small>페어 연계 판정은 PHASE 3 에서 연결됩니다.</small>
            </p>
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

          <h3 className="sub-title">AUTHORITY</h3>
          <ActionList
            actions={CONSTELLATION_ACTIONS}
            pair={pair}
            target={target}
            selectedId={submission.constellationActionId}
            locked={locked || pair.constellation.control === 'AUTO'}
            onSelect={(id) => selectAction('CONSTELLATION', id)}
          />
        </article>
      </section>

      {/* ── 행동 확정 ── */}
      <section className="panel confirm">
        {battle.status !== 'ENGAGED' ? (
          <p className="confirm-note">
            {battle.status === 'CLEARED' ? 'OPERATION CLEARED' : 'OPERATION FAILED'}
            <small>새 전투를 시작하려면 위에서 프리셋을 선택하세요.</small>
          </p>
        ) : submission.submitted ? (
          <div className="confirm-done">
            <p>
              ACTION SUBMITTED
              <small>Waiting for Raid Control…</small>
            </p>
            {UI_RULES.allowCancelAfterSubmit && (
              <button type="button" className="ctl" onClick={cancelAction}>
                CANCEL
              </button>
            )}
          </div>
        ) : (
          <button type="button" className="confirm-btn" disabled={!canConfirm} onClick={confirmAction}>
            CONFIRM ACTION
            {!canConfirm && (
              <small>
                {isDown(pair.hunter)
                  ? '헌터 전투 불능 — 구조 대기 (PHASE 3)'
                  : '조작 중인 쪽의 행동을 선택하세요 · 자리를 비운 쪽은 AUTO 로 위임'}
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
                    <span className={`tag ${state === 'WAITING' ? 'warn' : state === 'DOWN' ? 'offline' : 'ok'}`}>
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

      {/* ── 라운드 처리 ── */}
      <section className="panel process">
        <div className="process-head">
          <h2 className="panel-title">ROUND PROCESS</h2>
          <span className="hint">
            운영진 화면은 PHASE 5 에서 분리됩니다. 현재는 이 단말에서 직접 처리합니다.
          </span>
        </div>

        {!preview ? (
          <button
            type="button"
            className="ctl wide"
            disabled={!allReady || battle.status !== 'ENGAGED'}
            onClick={runPreview}
          >
            PROCESS ROUND
            {!allReady && <small>미제출 페어가 있습니다 — 자동 행동으로 위임할 수 있습니다</small>}
          </button>
        ) : (
          <div className="preview">
            <table className="preview-table">
              <thead>
                <tr>
                  <th>PAIR</th>
                  <th>HUNTER</th>
                  <th>CONSTELLATION</th>
                  <th>DAMAGE</th>
                  <th>NOTE</th>
                </tr>
              </thead>
              <tbody>
                {preview.pairs.map((row) => (
                  <tr key={row.pairId}>
                    <td>{row.pairLabel}</td>
                    <td>
                      {findAction(row.hunterActionId)?.label ?? '—'}
                      {row.autoFilled.includes('HUNTER') && <span className="tag auto">AUTO</span>}
                    </td>
                    <td>
                      {findAction(row.constellationActionId)?.label ?? '—'}
                      {row.autoFilled.includes('CONSTELLATION') && (
                        <span className="tag auto">AUTO</span>
                      )}
                    </td>
                    <td className="num">{row.damageToEnemy}</td>
                    <td className="dim small-text">
                      {row.skipped ? row.skipReason : row.notes.slice(0, 2).join(' / ')}
                    </td>
                  </tr>
                ))}
                {preview.enemies.map((row) => (
                  <tr key={row.enemyId} className="enemy-row">
                    <td>{row.enemyName}</td>
                    <td colSpan={2}>{row.pattern}</td>
                    <td className="num danger-text">-{row.damageToHunter}</td>
                    <td className="dim small-text">{row.notes[0]}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={3}>TOTAL</th>
                  <th className="num">{preview.totals.damageToEnemies}</th>
                  <th className="num danger-text">-{preview.totals.damageToHunters}</th>
                </tr>
              </tfoot>
            </table>
            <div className="btn-row">
              <button type="button" className="ctl primary" onClick={applyPreview}>
                APPLY
              </button>
              <button type="button" className="ctl" onClick={() => setPreview(null)}>
                CANCEL
              </button>
            </div>
            <p className="hint">
              자동 계산 결과를 운영진이 직접 수정하는 기능은 PHASE 5 에서 이 화면에 붙습니다.
            </p>
          </div>
        )}
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
              .slice(0, 60)
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
