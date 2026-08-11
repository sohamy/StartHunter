/**
 * 운영진 중앙 작전실 (Phase 5).
 *
 * 참가자 화면과 분리된 관리 화면이다.
 * 원칙: 자동 판정 결과를 운영진이 언제든 덮어쓸 수 있어야 한다.
 * APPLY 전에는 예상 결과를 직접 수정하고, 언제든 상태를 직접 편집한다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CONSTELLATION_STAGES, CONTRACT_STAGES } from '../config/rules';
import { GIMMICK_DEFINITIONS } from '../config/gimmicks';
import { STATUS_DEFINITIONS } from '../config/status';
import * as admin from '../engine/admin';
import { createBattle } from '../engine/battle';
import { nextPatternAdmin } from '../engine/enemy';
import { applyRound, previewRound } from '../engine/round';
import { injuryOf, statusViews } from '../engine/status';
import { AuthError, getAuth, getServerAuth, getStorage, isServerMode, type PublicProfile } from '../store';
import { pairPreset, presetSheet } from '../config/scenario';
import type {
  ActorSide,
  BattleState,
  BattleSummary,
  ConstellationStage,
  ContractStage,
  RoundPreview,
  StatusHolder,
} from '../types';

type PairFilter = 'ALL' | 'GOVERNMENT' | 'GUILD' | 'INJURED' | 'DOWN' | 'NOT_SUBMITTED';
type LogTab = 'SYSTEM' | 'ROLEPLAY';

function terminalUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/battle/`;
}

/* ── 숫자 입력 ─────────────────────────────────────────── */

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

/* ── 상태이상 편집 ─────────────────────────────────────── */

function StatusEditor({
  holder,
  ownerId,
  statuses,
  onGrant,
  onRevoke,
}: {
  holder: StatusHolder;
  ownerId: string;
  statuses: Parameters<typeof statusViews>[0];
  onGrant: (holder: StatusHolder, ownerId: string, defId: string) => void;
  onRevoke: (holder: StatusHolder, ownerId: string, defId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const views = statusViews(statuses);

  return (
    <div className="status-editor">
      <div className="target-status">
        {views.length === 0 ? (
          <span className="dim">NONE</span>
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
          {open ? 'CLOSE' : '+ STATUS'}
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
  const auth = useMemo(() => getAuth(), []);
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  const [pairingHunter, setPairingHunter] = useState('');
  const [pairingConstellation, setPairingConstellation] = useState('');
  const [battles, setBattles] = useState<BattleSummary[]>([]);
  const [battle, setBattle] = useState<BattleState | null>(null);
  const [preview, setPreview] = useState<RoundPreview | null>(null);
  const [filter, setFilter] = useState<PairFilter>('ALL');
  const [logTab, setLogTab] = useState<LogTab>('SYSTEM');
  const [message, setMessage] = useState<string | null>(null);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [logDraft, setLogDraft] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  // 서버 모드에서는 운영진 인증이 필요하다. 로컬 모드는 인증 자체가 없다.
  const serverAuth = useMemo(() => getServerAuth(), []);
  const [access, setAccess] = useState<'CHECKING' | 'LOCAL' | 'DENIED' | 'GRANTED'>(
    isServerMode() ? 'CHECKING' : 'LOCAL',
  );
  const [operatorId, setOperatorId] = useState('');
  const [operatorPassword, setOperatorPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const checkOperator = useCallback(async () => {
    if (!serverAuth) return;
    const session = await serverAuth.currentSession();
    if (!session) {
      setAccess('DENIED');
      return;
    }
    setAccess((await serverAuth.isOperator()) ? 'GRANTED' : 'DENIED');
  }, [serverAuth]);

  useEffect(() => {
    void checkOperator();
  }, [checkOperator]);

  const operatorLogin = async () => {
    if (!serverAuth) return;
    setBusy(true);
    setMessage(null);
    try {
      await serverAuth.login({ id: operatorId, password: operatorPassword });
      if (await serverAuth.isOperator()) {
        setAccess('GRANTED');
      } else {
        setAccess('DENIED');
        setMessage('이 계정은 운영진 권한이 없습니다. profiles.role 을 OPERATOR 로 변경하세요.');
      }
    } catch (error) {
      setMessage(error instanceof AuthError ? error.message : '접속에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const refreshList = useCallback(async () => {
    setBattles(await storage.listBattles());
  }, [storage]);

  useEffect(() => {
    void refreshList();
    void (async () => setProfiles(await auth.listProfiles()))();
  }, [auth, refreshList]);

  useEffect(() => {
    if (battle) void storage.saveBattle(battle);
  }, [battle, storage]);

  const update = useCallback((next: BattleState) => {
    setBattle(next);
    setPreview(null);
  }, []);

  const loadBattle = async (id: string) => {
    const loaded = await storage.loadBattle(id);
    if (!loaded) {
      setMessage('전투 데이터를 불러올 수 없습니다. (스키마 버전 불일치일 수 있습니다)');
      return;
    }
    setBattle(loaded);
    setPreview(null);
    setMessage(null);
  };

  const exportJson = async () => {
    const json = await storage.exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tower-raid-backup.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage('전체 전투 데이터를 내보냈습니다.');
  };

  const importJson = async (file: File) => {
    try {
      await storage.importAll(await file.text());
      await refreshList();
      setMessage('데이터를 불러왔습니다. 목록에서 전투를 선택하세요.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '불러오기에 실패했습니다.');
    }
  };

  /** 운영진 편성 — 등록된 참가자 두 명을 한 페어로 묶는다 */
  const addPairing = async () => {
    if (!battle) return;
    if (pairingHunter && pairingHunter === pairingConstellation) {
      setMessage('한 참가자가 양쪽을 맡을 수 없습니다.');
      return;
    }

    const preset = pairPreset(battle.pairs.length);
    const hunterAccount = pairingHunter ? await auth.getAccount(pairingHunter) : null;
    const constellationAccount = pairingConstellation
      ? await auth.getAccount(pairingConstellation)
      : null;

    const hunterSheet =
      hunterAccount?.sheet ??
      presetSheet(preset.hunter, 'HUNTER', 'GOVERNMENT', battle.pairs.length);
    const constellationSheet =
      constellationAccount?.sheet ??
      presetSheet(preset.constellation, 'CONSTELLATION', 'GOVERNMENT', battle.pairs.length);

    update(
      admin.addPairing(battle, {
        hunterSheet,
        constellationSheet,
        hunterAccountId: hunterAccount?.id ?? null,
        constellationAccountId: constellationAccount?.id ?? null,
      }),
    );
    setPairingHunter('');
    setPairingConstellation('');
    setMessage('페어를 편성했습니다.');
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage('클립보드에 복사했습니다.');
    } catch {
      setMessage('복사에 실패했습니다. 텍스트를 직접 선택해 주세요.');
    }
  };

  /* ── 운영진 인증 게이트 ──────────────────────────── */

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
          <p className="hint" style={{ marginBottom: 12 }}>
            운영진 계정으로 접속하세요. 운영진은 캐릭터 시트가 없어도 됩니다.
          </p>
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
          <p className="hint">
            권한은 <code>profiles.role = 'OPERATOR'</code> 로 부여됩니다. 자세한 절차는
            <code> docs/SUPABASE_SETUP.md</code> 를 참고하세요.
          </p>
        </section>
      </div>
    );
  }

  /* ── 전투 미선택 ─────────────────────────────────── */

  if (!battle) {
    return (
      <div className="console">
        <header className="console-head">
          <div className="agency">
            <b>HUNTER MANAGEMENT AGENCY</b>
            <span>CENTRAL RAID CONTROL</span>
          </div>
          <span className="tag warn">NO OPERATION SELECTED</span>
        </header>

        {message && <p className="notice ok">{message}</p>}

        <section className="panel">
          <h2 className="panel-title">OPERATION LIST</h2>
          {battles.length === 0 ? (
            <p className="dim">저장된 전투가 없습니다.</p>
          ) : (
            <table className="preview-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>MODE</th>
                  <th>ROUND</th>
                  <th>STATUS</th>
                  <th>UPDATED</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {battles.map((row) => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td>{row.mode}</td>
                    <td className="num">{row.round}</td>
                    <td>
                      <span className={`tag ${row.status === 'ENGAGED' ? 'ok' : 'warn'}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="dim small-text">{row.updatedAt.slice(0, 19).replace('T', ' ')}</td>
                    <td>
                      <button type="button" className="ctl small" onClick={() => void loadBattle(row.id)}>
                        OPEN
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="btn-row" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="ctl primary"
              onClick={() =>
                update(createBattle({ mode: 'RAID', pairCount: 4, monsterCount: 1, id: 'BATTLE-CONTROL' }))
              }
            >
              CREATE RAID
            </button>
            <button
              type="button"
              className="ctl"
              onClick={() => update(createBattle({ mode: 'DUEL', id: 'BATTLE-CONTROL-DUEL' }))}
            >
              CREATE DUEL
            </button>
            <button type="button" className="ctl" onClick={() => void exportJson()}>
              EXPORT JSON
            </button>
            <button type="button" className="ctl" onClick={() => fileInput.current?.click()}>
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
            <a className="ctl" href={terminalUrl()}>
              참가자 단말 →
            </a>
          </div>
        </section>
      </div>
    );
  }

  /* ── 통계 ────────────────────────────────────────── */

  const injured = battle.pairs.filter(
    (pair) => pair.hunter.hp > 0 && pair.hunter.hp < pair.hunter.maxHp * 0.7,
  ).length;
  const down = battle.pairs.filter((pair) => pair.hunter.hp <= 0).length;
  const waitingSides = battle.pairs.flatMap((pair) => {
    const rows: Array<{ pairId: string; label: string; side: ActorSide }> = [];
    if (!pair.submission.hunterSubmitted && pair.hunter.control !== 'AUTO' && pair.hunter.hp > 0) {
      rows.push({ pairId: pair.id, label: pair.label, side: 'HUNTER' });
    }
    if (!pair.submission.constellationSubmitted && pair.constellation.control !== 'AUTO') {
      rows.push({ pairId: pair.id, label: pair.label, side: 'CONSTELLATION' });
    }
    return rows;
  });
  const notSubmitted = waitingSides.length;

  const filtered = battle.pairs.filter((pair) => {
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

  const systemLog = battle.log.filter((entry) => entry.channel === 'SYSTEM');
  const roleplayLog = battle.log.filter((entry) => entry.channel === 'ROLEPLAY');

  /* preview 수정 헬퍼 — 운영진이 자동 계산 결과를 덮어쓴다 */
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

  return (
    <div className="console wide">
      {/* ── 헤더 ── */}
      <header className="console-head">
        <div className="agency">
          <b>HUNTER MANAGEMENT AGENCY</b>
          <span>CENTRAL RAID CONTROL</span>
        </div>
        <dl className="ops">
          <div className="field">
            <span className="field-label">OPERATION</span>
            <span className="field-value">{battle.operation.name}</span>
          </div>
          <div className="field">
            <span className="field-label">FLOOR</span>
            <span className="field-value num">{battle.operation.floor}</span>
          </div>
          <div className="field">
            <span className="field-label">ROUND</span>
            <span className="field-value num">{String(battle.round).padStart(2, '0')}</span>
          </div>
          <div className="field">
            <span className="field-label">ACTIVE PAIRS</span>
            <span className="field-value num">{battle.pairs.length}</span>
          </div>
          <div className="field">
            <span className="field-label">INJURED</span>
            <span className={`field-value num ${injured > 0 ? 'warn-text' : ''}`}>{injured}</span>
          </div>
          <div className="field">
            <span className="field-label">DOWN</span>
            <span className={`field-value num ${down > 0 ? 'danger-text' : ''}`}>{down}</span>
          </div>
        </dl>
      </header>

      {message && <p className="notice ok">{message}</p>}

      {/* ── 전투 제어 ── */}
      <section className="panel session">
        <div className="session-row">
          <span className="field-label">OPERATION</span>
          <span className="field-value">{battle.id}</span>
          <span className={`tag ${battle.status === 'ENGAGED' ? 'ok' : 'warn'}`}>{battle.status}</span>
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
              onClick={() => update(admin.setBattleStatus(battle, 'ENGAGED'))}
            >
              ENGAGE
            </button>
            <button
              type="button"
              className="ctl small"
              onClick={() => update(admin.setBattleStatus(battle, 'CLEARED'))}
            >
              END · CLEARED
            </button>
            <button
              type="button"
              className="ctl small"
              onClick={() => update(admin.setBattleStatus(battle, 'FAILED'))}
            >
              END · FAILED
            </button>
          </div>
        </div>
        <div className="session-row">
          <span className="field-label">DATA</span>
          <div className="btn-row">
            <button type="button" className="ctl small" onClick={() => void exportJson()}>
              EXPORT JSON
            </button>
            <button type="button" className="ctl small" onClick={() => fileInput.current?.click()}>
              IMPORT JSON
            </button>
            <button
              type="button"
              className="ctl small"
              onClick={() => {
                setBattle(null);
                void refreshList();
              }}
            >
              CLOSE OPERATION
            </button>
            <button type="button" className="ctl small" onClick={() => update(admin.addPresetPair(battle))}>
              + ADD PAIR
            </button>
            <a className="ctl small" href={terminalUrl()}>
              참가자 단말 →
            </a>
          </div>
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

      {/* ── 타깃 상황판 ── */}
      <section className="panel">
        <h2 className="panel-title">TARGET STATUS</h2>
        <div className="target-grid">
          {battle.enemies.map((enemy) => (
            <article key={enemy.id} className={`target ${enemy.boss ? 'boss' : ''}`}>
              <div className="target-head">
                <span className="grade">{enemy.grade}</span>
                <b>{enemy.name}</b>
              </div>
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
                  onCommit={(value) => update(admin.setEnemyStats(battle, enemy.id, { maxHp: value }))}
                />
                <NumberField
                  label="ATK"
                  value={enemy.attack}
                  onCommit={(value) => update(admin.setEnemyStats(battle, enemy.id, { attack: value }))}
                />
                <NumberField
                  label="DEF"
                  value={enemy.defense}
                  onCommit={(value) => update(admin.setEnemyStats(battle, enemy.id, { defense: value }))}
                />
                <NumberField
                  label="PHASE"
                  value={enemy.phase}
                  min={1}
                  max={enemy.maxPhase}
                  onCommit={(value) => update(admin.setEnemyPhase(battle, enemy.id, value))}
                />
              </div>

              <div className="target-status">
                <span className="field-label">STATUS</span>
              </div>
              <StatusEditor
                holder="ENEMY"
                ownerId={enemy.id}
                statuses={enemy.statuses}
                onGrant={(holder, ownerId, defId) => update(admin.grantStatus(battle, holder, ownerId, defId))}
                onRevoke={(holder, ownerId, defId) => update(admin.revokeStatus(battle, holder, ownerId, defId))}
              />

              <div className="admin-only">
                <span className="field-label">ADMIN ONLY · NEXT PATTERN</span>
                <b className="gold">{nextPatternAdmin(enemy, battle.round)}</b>
                {enemy.telegraph && (
                  <>
                    <span className="tag critical">
                      TELEGRAPH {Math.max(0, enemy.telegraph.roundsLeft)}R
                    </span>
                    <button
                      type="button"
                      className="ctl small"
                      onClick={() => update(admin.clearTelegraph(battle, enemy.id))}
                    >
                      CANCEL
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>

        {battle.gimmick && (
          <div className="admin-gimmick">
            <span className="field-label">GIMMICK</span>
            <b>{battle.gimmick.label}</b>
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
            <NumberField
              label="PROGRESS"
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
              <option value="ACTIVE">ACTIVE</option>
              <option value="CLEARED">CLEARED</option>
              <option value="FAILED">FAILED</option>
            </select>
            <select
              className="ctl"
              value={battle.gimmick.defId}
              onChange={(event) => update(admin.setGimmick(battle, event.target.value || null))}
            >
              {GIMMICK_DEFINITIONS.map((def) => (
                <option key={def.id} value={def.id}>
                  {def.label} · {def.labelKo}
                </option>
              ))}
              <option value="">NONE</option>
            </select>
          </div>
        )}
      </section>

      {/* ── 페어 편성 ── */}
      <section className="panel">
        <div className="process-head">
          <h2 className="panel-title">PAIRING</h2>
          <span className="hint">
            짝을 맺는 권한은 운영진에게 있습니다. 1인 = 1캐릭터이므로 같은 참가자를 양쪽에 넣을 수 없습니다.
          </span>
        </div>
        <div className="pairing-row">
          <label className="num-field">
            <span className="field-label">HUNTER 참가자</span>
            <select
              className="ctl input"
              value={pairingHunter}
              onChange={(event) => setPairingHunter(event.target.value)}
            >
              <option value="">— 프리셋 NPC —</option>
              {profiles
                .filter((profile) => profile.side === 'HUNTER')
                .map((profile) => (
                  <option key={profile.accountId} value={profile.accountId}>
                    {profile.name} · {profile.accountId}
                  </option>
                ))}
            </select>
          </label>
          <span className="pairing-x">×</span>
          <label className="num-field">
            <span className="field-label">CONSTELLATION 참가자</span>
            <select
              className="ctl input"
              value={pairingConstellation}
              onChange={(event) => setPairingConstellation(event.target.value)}
            >
              <option value="">— 프리셋 NPC —</option>
              {profiles
                .filter((profile) => profile.side === 'CONSTELLATION')
                .map((profile) => (
                  <option key={profile.accountId} value={profile.accountId}>
                    {profile.name} · {profile.accountId}
                  </option>
                ))}
            </select>
          </label>
          <button type="button" className="ctl primary" onClick={() => void addPairing()}>
            + 페어 편성
          </button>
        </div>
        <p className="hint">
          등록된 참가자 {profiles.length}명 · 헌터{' '}
          {profiles.filter((p) => p.side === 'HUNTER').length} / 성좌{' '}
          {profiles.filter((p) => p.side === 'CONSTELLATION').length}
        </p>
      </section>

      {/* ── 이탈자 처리 ── */}
      {notSubmitted > 0 && (
        <section className="panel desertion">
          <div className="process-head">
            <h2 className="panel-title">UNSUBMITTED · {notSubmitted}</h2>
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
                <span className={`tag ${row.side === 'HUNTER' ? 'blue' : 'gold'}`}>{row.side}</span>
                <span className="tag warn">WAITING</span>
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
          <p className="hint">
            이탈이 확인된 쪽을 자동 행동으로 돌리면 남은 참가자만으로 라운드를 진행할 수 있습니다.
          </p>
        </section>
      )}

      {/* ── 페어 모니터 ── */}
      <section className="panel">
        <div className="process-head">
          <h2 className="panel-title">PAIR MONITOR</h2>
          <div className="btn-row">
            {(
              [
                ['ALL', 'ALL'],
                ['GOVERNMENT', 'GOV'],
                ['GUILD', 'GUILD'],
                ['INJURED', `INJURED ${injured}`],
                ['DOWN', `DOWN ${down}`],
                ['NOT_SUBMITTED', `NOT SUBMITTED ${notSubmitted}`],
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
          {filtered.map((pair) => {
            const injury = injuryOf(pair.hunter);
            const hunterReady =
              pair.submission.hunterSubmitted || pair.hunter.control === 'AUTO';
            const constellationReady =
              pair.submission.constellationSubmitted || pair.constellation.control === 'AUTO';
            const state =
              pair.hunter.hp <= 0
                ? 'DOWN'
                : hunterReady && constellationReady
                  ? 'READY'
                  : 'WAITING';

            return (
              <article key={pair.id} className="monitor-card">
                <header className="monitor-head">
                  <div>
                    <b>{pair.label}</b>
                    <span className={`tag ${pair.affiliation === 'GOVERNMENT' ? 'blue' : 'gold'}`}>
                      {pair.affiliation === 'GOVERNMENT' ? 'GOVERNMENT' : 'PRIVATE GUILD'}
                    </span>
                  </div>
                  <div className="btn-row">
                    <span
                      className={`tag ${
                        state === 'WAITING' ? 'warn' : state === 'DOWN' ? 'offline' : 'ok'
                      }`}
                    >
                      {state}
                    </span>
                    <button
                      type="button"
                      className="ctl small"
                      onClick={() => update(admin.resetSubmission(battle, pair.id))}
                    >
                      RESET
                    </button>
                    {battle.pairs.length > 1 && (
                      <button
                        type="button"
                        className="ctl small"
                        onClick={() => update(admin.removePair(battle, pair.id))}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </header>

                {/* 헌터 */}
                <div className="monitor-actor">
                  <div className="monitor-actor-head">
                    <span className="field-label">HUNTER</span>
                    <b>{pair.hunter.name}</b>
                    <span className={`tag ${injury.tone}`}>{injury.label}</span>
                  </div>
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
                      label="AP"
                      value={pair.hunter.ap}
                      max={99}
                      onCommit={(value) => update(admin.setActorAp(battle, pair.id, 'HUNTER', value))}
                    />
                    <NumberField
                      label="MAX AP"
                      value={pair.hunter.maxAp}
                      onCommit={(value) => update(admin.setActorMaxAp(battle, pair.id, 'HUNTER', value))}
                    />
                    <NumberField
                      label="ATK"
                      value={pair.hunter.attack}
                      onCommit={(value) => update(admin.setHunterStats(battle, pair.id, { attack: value }))}
                    />
                    <NumberField
                      label="DEF"
                      value={pair.hunter.defense}
                      onCommit={(value) => update(admin.setHunterStats(battle, pair.id, { defense: value }))}
                    />
                  </div>
                  <StatusEditor
                    holder="HUNTER"
                    ownerId={pair.id}
                    statuses={pair.hunter.statuses}
                    onGrant={(holder, ownerId, defId) => update(admin.grantStatus(battle, holder, ownerId, defId))}
                    onRevoke={(holder, ownerId, defId) => update(admin.revokeStatus(battle, holder, ownerId, defId))}
                  />
                  {pair.hunter.skills.length > 0 && (
                    <ul className="admin-skills">
                      {pair.hunter.skills.map((skill) => (
                        <li key={skill.id}>
                          <b>{skill.name}</b>
                          <NumberField
                            label="POWER"
                            value={skill.power}
                            step={0.1}
                            onCommit={(value) =>
                              update(admin.patchSkill(battle, pair.id, 'HUNTER', skill.id, { power: value }))
                            }
                          />
                          <NumberField
                            label="CD"
                            value={skill.currentCooldown}
                            onCommit={(value) =>
                              update(
                                admin.patchSkill(battle, pair.id, 'HUNTER', skill.id, {
                                  currentCooldown: value,
                                }),
                              )
                            }
                          />
                          {skill.remainingUses !== null && (
                            <NumberField
                              label="USES"
                              value={skill.remainingUses}
                              onCommit={(value) =>
                                update(
                                  admin.patchSkill(battle, pair.id, 'HUNTER', skill.id, {
                                    remainingUses: value,
                                  }),
                                )
                              }
                            />
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* 성좌 */}
                <div className="monitor-actor">
                  <div className="monitor-actor-head">
                    <span className="field-label">CONSTELLATION</span>
                    <b>{pair.constellation.name}</b>
                  </div>
                  <div className="admin-grid">
                    <NumberField
                      label="AP"
                      value={pair.constellation.ap}
                      onCommit={(value) => update(admin.setActorAp(battle, pair.id, 'CONSTELLATION', value))}
                    />
                    <NumberField
                      label="MAX AP"
                      value={pair.constellation.maxAp}
                      onCommit={(value) =>
                        update(admin.setActorMaxAp(battle, pair.id, 'CONSTELLATION', value))
                      }
                    />
                    <NumberField
                      label="POWER"
                      value={pair.constellation.power}
                      step={0.01}
                      onCommit={(value) => update(admin.setConstellationPower(battle, pair.id, value))}
                    />
                    <NumberField
                      label="MANIFEST"
                      value={pair.constellation.manifestUses.partial ?? 0}
                      onCommit={(value) => update(admin.setManifestUses(battle, pair.id, { partial: value }))}
                    />
                    <NumberField
                      label="FULL"
                      value={pair.constellation.manifestUses.full ?? 0}
                      onCommit={(value) => update(admin.setManifestUses(battle, pair.id, { full: value }))}
                    />
                    <NumberField
                      label="POINT"
                      value={pair.points}
                      step={10}
                      onCommit={(value) => update(admin.setPairPoints(battle, pair.id, value))}
                    />
                  </div>
                  <div className="admin-grid">
                    <label className="num-field">
                      <span className="field-label">EXISTENCE</span>
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
                            {def.label} · {def.labelKo}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="num-field">
                      <span className="field-label">CONTRACT</span>
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
                            {def.label} · {def.labelKo}
                          </option>
                        ))}
                      </select>
                    </label>
                    <NumberField
                      label="LINK"
                      value={pair.contract.value}
                      max={100}
                      onCommit={(value) => update(admin.setContract(battle, pair.id, { value }))}
                    />
                  </div>
                  <StatusEditor
                    holder="CONSTELLATION"
                    ownerId={pair.id}
                    statuses={pair.constellation.statuses}
                    onGrant={(holder, ownerId, defId) => update(admin.grantStatus(battle, holder, ownerId, defId))}
                    onRevoke={(holder, ownerId, defId) => update(admin.revokeStatus(battle, holder, ownerId, defId))}
                  />
                </div>

                <div className="monitor-submission">
                  {(['HUNTER', 'CONSTELLATION'] as ActorSide[]).map((side) => {
                    const control =
                      side === 'HUNTER' ? pair.hunter.control : pair.constellation.control;
                    const submitted =
                      side === 'HUNTER'
                        ? pair.submission.hunterSubmitted
                        : pair.submission.constellationSubmitted;
                    const accountId =
                      side === 'HUNTER' ? pair.hunterAccountId : pair.constellationAccountId;
                    const actionId =
                      side === 'HUNTER'
                        ? pair.submission.hunterActionId
                        : pair.submission.constellationActionId;

                    return (
                      <div className="submission-row" key={side}>
                        <span className={`tag ${side === 'HUNTER' ? 'blue' : 'gold'}`}>{side}</span>
                        <select
                          className="ctl small"
                          value={accountId ?? ''}
                          onChange={(event) =>
                            update(
                              admin.assignAccount(battle, pair.id, side, event.target.value || null),
                            )
                          }
                        >
                          <option value="">— NPC —</option>
                          {profiles
                            .filter((profile) => profile.side === side)
                            .map((profile) => (
                              <option key={profile.accountId} value={profile.accountId}>
                                {profile.accountId}
                              </option>
                            ))}
                        </select>
                        <span className="dim small-text">{actionId ?? '미선택'}</span>
                        <span className={`tag ${submitted ? 'ok' : 'warn'}`}>
                          {submitted ? 'SUBMITTED' : 'WAITING'}
                        </span>
                        <button
                          type="button"
                          className={`ctl small ${control === 'AUTO' ? 'on' : ''}`}
                          onClick={() =>
                            update(
                              admin.forceControl(
                                battle,
                                pair.id,
                                side,
                                control === 'AUTO' ? 'ACTIVE' : 'AUTO',
                              ),
                            )
                          }
                        >
                          {control === 'AUTO' ? 'AUTO 해제' : '강제 AUTO'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* ── 라운드 처리 ── */}
      <section className="panel process">
        <div className="process-head">
          <h2 className="panel-title">ROUND PROCESS</h2>
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
            PROCESS ROUND
            {notSubmitted > 0 && (
              <small>미제출 {notSubmitted}페어 — 자동 행동으로 채워집니다</small>
            )}
          </button>
        ) : (
          <div className="preview">
            <table className="preview-table editable">
              <thead>
                <tr>
                  <th>PAIR</th>
                  <th>HUNTER</th>
                  <th>CONSTELLATION</th>
                  <th>LINK</th>
                  <th>DAMAGE</th>
                  <th>NOTE</th>
                </tr>
              </thead>
              <tbody>
                {preview.pairs.map((row) => (
                  <tr key={row.pairId}>
                    <td>{row.pairLabel}</td>
                    <td>
                      {row.hunterActionLabel}
                      {row.autoFilled.includes('HUNTER') && <span className="tag auto">AUTO</span>}
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
                      {[
                        row.skipped ? row.skipReason : null,
                        row.rescue ? `구조 ${row.rescue.targetLabel} +${row.rescue.restoredHp}` : null,
                        row.gimmickProgress > 0 ? `기믹 +${row.gimmickProgress}` : null,
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
                      {row.aoe && <span className="tag critical">AOE</span>}
                      {row.blocked && <span className="tag ok">BLOCKED</span>}
                      {row.telegraph && <span className="tag warn">TELEGRAPH</span>}
                    </td>
                    <td>
                      <input
                        className="ctl input tiny"
                        type="number"
                        value={row.damageToHunter}
                        onChange={(event) =>
                          patchPreviewEnemy(row.enemyId, Math.max(0, Number(event.target.value) || 0))
                        }
                      />
                    </td>
                    <td className="dim small-text">{row.notes[0]}</td>
                  </tr>
                ))}

                {preview.statusTicks.map((tick) => (
                  <tr key={`${tick.ownerId}-${tick.defId}`} className="tick-row">
                    <td>{tick.ownerLabel}</td>
                    <td colSpan={3}>{tick.label}</td>
                    <td className="num">{tick.amount}</td>
                    <td className="dim small-text">ROUND END</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={4}>TOTAL</th>
                  <th className="num">
                    {preview.pairs.reduce((sum, row) => sum + row.damageToEnemy, 0)}
                  </th>
                  <th className="num danger-text">
                    -{preview.enemies.reduce((sum, row) => sum + row.damageToHunter, 0)}
                  </th>
                </tr>
              </tfoot>
            </table>

            {preview.alerts.length > 0 && (
              <ul className="preview-alerts">
                {preview.alerts.map((item) => (
                  <li key={`${item.title}-${item.message}`}>
                    <span className="tag critical">{item.level}</span> {item.title} — {item.message}
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
                  setLogTab('ROLEPLAY');
                }}
              >
                APPLY
              </button>
              <button type="button" className="ctl" onClick={() => setPreview(previewRound(battle))}>
                RECALCULATE
              </button>
              <button type="button" className="ctl" onClick={() => setPreview(null)}>
                CANCEL
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── 로그 ── */}
      <section className="panel log">
        <div className="process-head">
          <div className="btn-row">
            <button
              type="button"
              className={`ctl small ${logTab === 'SYSTEM' ? 'on' : ''}`}
              onClick={() => setLogTab('SYSTEM')}
            >
              SYSTEM LOG
            </button>
            <button
              type="button"
              className={`ctl small ${logTab === 'ROLEPLAY' ? 'on' : ''}`}
              onClick={() => setLogTab('ROLEPLAY')}
            >
              ROLEPLAY LOG
            </button>
          </div>
          {battle.alerts.length > 0 && (
            <button type="button" className="ctl small" onClick={() => update(admin.clearAlerts(battle))}>
              CLEAR ALERTS
            </button>
          )}
        </div>

        {logTab === 'SYSTEM' ? (
          <ol className="log-list">
            {[...systemLog]
              .reverse()
              .slice(0, 120)
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
            {roleplayLog.length === 0 && <p className="dim">라운드를 처리하면 연출 로그가 생성됩니다.</p>}
            {[...roleplayLog].reverse().map((entry) => (
              <article className="roleplay-block" key={entry.id}>
                <header className="roleplay-head">
                  <span className="field-label">
                    ROUND {String(entry.round).padStart(2, '0')} · {entry.at}
                    {entry.edited && <span className="tag warn"> EDITED</span>}
                  </span>
                  <div className="btn-row">
                    <button type="button" className="ctl small" onClick={() => void copyText(entry.text)}>
                      COPY
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
                          SAVE
                        </button>
                        <button type="button" className="ctl small" onClick={() => setEditingLogId(null)}>
                          CANCEL
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
                        EDIT
                      </button>
                    )}
                    <button
                      type="button"
                      className="ctl small"
                      onClick={() => update(admin.removeLogEntry(battle, entry.id))}
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
    </div>
  );
}
