/**
 * 계약 등록 단말 — 로그인 · 회원가입(캐릭터 시트 작성).
 *
 * 회원가입이 곧 캐릭터 시트 작성이다.
 * 스탯 배분 결과가 전투 수치로 어떻게 환산되는지 화면에서 바로 보여준다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  POINT_BUY,
  classesFor,
  findClass,
  initialStats,
  remainingPoints,
  statsFor,
} from '../config/characters';
import { SKILL_RULES, blankSkill, findSkillKind, skillKindsFor } from '../config/skills';
import { selectableStatuses } from '../config/status';
import { deriveConstellation, deriveHunter, validateSheet } from '../engine/character';
import { AuthError, getAuth, isServerMode } from '../store';
import type {
  Account,
  ActorSide,
  Affiliation,
  CharacterSheet,
  SkillDefinition,
  StatBlock,
} from '../types';

type Mode = 'LOGIN' | 'REGISTER';

interface DraftSheet {
  side: ActorSide;
  name: string;
  classId: string;
  stats: StatBlock;
  skills: SkillDefinition[];
  concept: string;
  affiliation: Affiliation;
}

function emptyDraft(side: ActorSide): DraftSheet {
  return {
    side,
    name: '',
    classId: '',
    stats: initialStats(side),
    skills: [],
    concept: '',
    affiliation: 'GOVERNMENT',
  };
}

/** 배틀 페이지 경로 — base 경로를 반영한다 */
function battleUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/battle/`;
}

function StatRow({
  statKey,
  label,
  labelKo,
  effect,
  activeFrom,
  value,
  canIncrease,
  onChange,
}: {
  statKey: string;
  label: string;
  labelKo: string;
  effect: string;
  activeFrom: number;
  value: number;
  canIncrease: boolean;
  onChange: (key: string, next: number) => void;
}) {
  return (
    <div className="stat-row">
      <div className="stat-name">
        <b>{label}</b>
        <span>{labelKo}</span>
      </div>
      <div className="stat-ctl">
        <button
          type="button"
          className="ctl small"
          disabled={value <= POINT_BUY.baseValue}
          onClick={() => onChange(statKey, value - 1)}
          aria-label={`${labelKo} 감소`}
        >
          −
        </button>
        <span className="stat-value num">{value}</span>
        <button
          type="button"
          className="ctl small"
          disabled={!canIncrease || value >= POINT_BUY.maxValue}
          onClick={() => onChange(statKey, value + 1)}
          aria-label={`${labelKo} 증가`}
        >
          +
        </button>
      </div>
      <div className="stat-track" aria-hidden="true">
        {Array.from({ length: POINT_BUY.maxValue }, (_, index) => (
          <i key={index} className={index < value ? 'on' : ''} />
        ))}
      </div>
      <p className="stat-effect">
        {effect}
        {activeFrom > 1 && <span className="tag warn">PHASE {activeFrom}</span>}
      </p>
    </div>
  );
}

/* ── 커스텀 스킬 편집기 ─────────────────────────────── */

function SkillEditor({
  side,
  skills,
  onChange,
}: {
  side: ActorSide;
  skills: SkillDefinition[];
  onChange: (next: SkillDefinition[]) => void;
}) {
  const kinds = skillKindsFor(side);
  const statuses = selectableStatuses();

  const patch = (index: number, next: Partial<SkillDefinition>) => {
    onChange(skills.map((skill, i) => (i === index ? { ...skill, ...next } : skill)));
  };

  const toggleStatus = (index: number, defId: string) => {
    const current = skills[index].applyStatusIds;
    const next = current.includes(defId)
      ? current.filter((id) => id !== defId)
      : current.length >= SKILL_RULES.maxStatuses
        ? current
        : [...current, defId];
    patch(index, { applyStatusIds: next });
  };

  return (
    <div className="skill-editor">
      {skills.length === 0 && (
        <p className="hint">
          등록한 스킬이 없습니다. 스킬 없이도 참여할 수 있지만, 기본 행동만 사용하게 됩니다.
        </p>
      )}

      {skills.map((skill, index) => {
        const kindDef = findSkillKind(skill.kind);
        return (
          <article className="skill-card" key={skill.id}>
            <header className="skill-head">
              <span className="field-label">SKILL {index + 1}</span>
              <button
                type="button"
                className="ctl small"
                onClick={() => onChange(skills.filter((_, i) => i !== index))}
              >
                REMOVE
              </button>
            </header>

            <div className="skill-grid">
              <label className="input-row">
                <span className="field-label">이름</span>
                <input
                  className="ctl input"
                  value={skill.name}
                  maxLength={SKILL_RULES.nameMaxLength}
                  onChange={(event) => patch(index, { name: event.target.value })}
                  placeholder="예: STAR SLASH"
                />
              </label>

              <label className="input-row">
                <span className="field-label">종류</span>
                <select
                  className="ctl input"
                  value={skill.kind}
                  onChange={(event) => {
                    const kind = event.target.value as SkillDefinition['kind'];
                    patch(index, {
                      kind,
                      target: findSkillKind(kind)?.defaultTarget ?? skill.target,
                    });
                  }}
                >
                  {kinds.map((row) => (
                    <option key={row.kind} value={row.kind}>
                      {row.label} · {row.labelKo}
                      {row.activeFrom > 2 ? ` (PHASE ${row.activeFrom})` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label className="input-row">
                <span className="field-label">행동력 {skill.apCost}</span>
                <input
                  type="range"
                  min={SKILL_RULES.apCost.min}
                  max={SKILL_RULES.apCost.max}
                  step={1}
                  value={skill.apCost}
                  onChange={(event) => patch(index, { apCost: Number(event.target.value) })}
                />
              </label>

              <label className="input-row">
                <span className="field-label">기본 수치 {skill.power}</span>
                <input
                  type="range"
                  min={SKILL_RULES.power.min}
                  max={SKILL_RULES.power.max}
                  step={SKILL_RULES.power.step}
                  value={skill.power}
                  onChange={(event) => patch(index, { power: Number(event.target.value) })}
                />
              </label>

              <label className="input-row">
                <span className="field-label">쿨타임 {skill.cooldown}R</span>
                <input
                  type="range"
                  min={SKILL_RULES.cooldown.min}
                  max={SKILL_RULES.cooldown.max}
                  step={1}
                  value={skill.cooldown}
                  onChange={(event) => patch(index, { cooldown: Number(event.target.value) })}
                />
              </label>

              <label className="input-row">
                <span className="field-label">
                  전투당 사용 {skill.maxUses === null ? '무제한' : `${skill.maxUses}회`}
                </span>
                <input
                  type="range"
                  min={SKILL_RULES.maxUses.min}
                  max={SKILL_RULES.maxUses.max}
                  step={1}
                  value={skill.maxUses ?? 0}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    patch(index, { maxUses: value === 0 ? null : value });
                  }}
                />
              </label>
            </div>

            <p className="hint">{kindDef?.powerMeaning}</p>

            <div className="input-row">
              <span className="field-label">
                부여 상태이상 (최대 {SKILL_RULES.maxStatuses})
              </span>
              <div className="status-picker">
                {statuses.map((status) => (
                  <button
                    key={status.id}
                    type="button"
                    className={`chip-btn ${skill.applyStatusIds.includes(status.id) ? 'on' : ''}`}
                    onClick={() => toggleStatus(index, status.id)}
                    title={`${status.description} · ${status.duration}R`}
                  >
                    {status.label}
                    <small>{status.labelKo}</small>
                  </button>
                ))}
              </div>
            </div>

            <label className="input-row">
              <span className="field-label">설명</span>
              <input
                className="ctl input"
                value={skill.description}
                maxLength={SKILL_RULES.descriptionMaxLength}
                onChange={(event) => patch(index, { description: event.target.value })}
                placeholder="연출과 효과를 간단히"
              />
            </label>

            <label className="input-row">
              <span className="field-label">특수 효과 (운영진 판정)</span>
              <input
                className="ctl input"
                value={skill.special}
                maxLength={SKILL_RULES.specialMaxLength}
                onChange={(event) => patch(index, { special: event.target.value })}
                placeholder="수치로 표현되지 않는 효과 (선택)"
              />
            </label>
          </article>
        );
      })}

      {skills.length < SKILL_RULES.maxSkills && (
        <button
          type="button"
          className="ctl wide"
          onClick={() => onChange([...skills, blankSkill(side, skills.length)])}
        >
          + ADD SKILL
          <small>
            {skills.length} / {SKILL_RULES.maxSkills}
          </small>
        </button>
      )}
    </div>
  );
}

export default function JoinTerminal() {
  const auth = useMemo(() => getAuth(), []);
  const [mode, setMode] = useState<Mode>('REGISTER');
  const [account, setAccount] = useState<Account | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const [loginId, setLoginId] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [registerId, setRegisterId] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [draft, setDraft] = useState<DraftSheet>(() => emptyDraft('HUNTER'));

  // 이미 로그인된 세션이 있으면 시트 화면으로 바로 넘긴다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await auth.currentSession();
      if (!session || cancelled) return;
      const found = await auth.getAccount(session.accountId);
      if (!cancelled && found) setAccount(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [auth]);

  const setSide = useCallback((side: ActorSide) => {
    setDraft((current) => ({
      ...emptyDraft(side),
      name: current.name,
      concept: current.concept,
      affiliation: current.affiliation,
    }));
  }, []);

  const changeStat = useCallback((key: string, next: number) => {
    setDraft((current) => ({ ...current, stats: { ...current.stats, [key]: next } }));
  }, []);

  const stats = statsFor(draft.side);
  const classes = classesFor(draft.side);
  const remaining = remainingPoints(draft.side, draft.stats);
  const selectedClass = findClass(draft.side, draft.classId);

  const previewSheet: CharacterSheet = {
    ...draft,
    id: 'PREVIEW',
    createdAt: '1970-01-01T00:00:00.000Z',
  };
  const derivedHunter = draft.side === 'HUNTER' ? deriveHunter(previewSheet) : null;
  const derivedConstellation =
    draft.side === 'CONSTELLATION' ? deriveConstellation(previewSheet) : null;

  const submitRegister = async () => {
    setErrors([]);
    setMessage(null);

    const issues = validateSheet(draft);
    if (issues.length > 0) {
      setErrors(issues.map((issue) => issue.message));
      return;
    }

    setBusy(true);
    try {
      const created = await auth.register({
        id: registerId,
        password: registerPassword,
        sheet: {
          side: draft.side,
          name: draft.name.trim(),
          classId: draft.classId,
          stats: draft.stats,
          skills: draft.skills.map((skill) => ({ ...skill, name: skill.name.trim() })),
          concept: draft.concept.trim(),
          affiliation: draft.affiliation,
        },
      });
      setAccount(created);
      setMessage('계약 등록 완료 — 시트가 저장되었습니다.');
    } catch (error) {
      setErrors([error instanceof AuthError ? error.message : '등록에 실패했습니다.']);
    } finally {
      setBusy(false);
    }
  };

  const submitLogin = async () => {
    setErrors([]);
    setMessage(null);
    setBusy(true);
    try {
      const session = await auth.login({ id: loginId, password: loginPassword });
      const found = await auth.getAccount(session.accountId);
      setAccount(found);
    } catch (error) {
      setErrors([error instanceof AuthError ? error.message : '접속에 실패했습니다.']);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await auth.logout();
    setAccount(null);
    setMessage('접속을 종료했습니다.');
  };

  /* ── 로그인 완료 화면 ─────────────────────────────── */
  if (account) {
    const sheet = account.sheet;
    const sheetClass = findClass(sheet.side, sheet.classId);
    const hunter = sheet.side === 'HUNTER' ? deriveHunter(sheet) : null;
    const constellation = sheet.side === 'CONSTELLATION' ? deriveConstellation(sheet) : null;

    return (
      <div className="console">
        <header className="console-head">
          <div className="agency">
            <b>HUNTER MANAGEMENT AGENCY</b>
            <span>CONTRACT REGISTRY</span>
          </div>
          <div className="btn-row">
            <span className="tag ok">AUTHENTICATED</span>
            <button type="button" className="ctl" onClick={logout}>
              LOG OUT
            </button>
          </div>
        </header>

        {message && <p className="notice ok">{message}</p>}

        <section className="panel">
          <h2 className="panel-title">REGISTERED SHEET</h2>
          <div className="sheet-view">
            <div>
              <div className="field">
                <span className="field-label">ACCOUNT</span>
                <span className="field-value">{account.id}</span>
              </div>
              <div className="field">
                <span className="field-label">ROLE</span>
                <span className={`tag ${sheet.side === 'HUNTER' ? 'blue' : 'gold'}`}>
                  {sheet.side}
                </span>
              </div>
              <div className="field">
                <span className="field-label">NAME</span>
                <span className="field-value">{sheet.name}</span>
              </div>
              <div className="field">
                <span className="field-label">{sheet.side === 'HUNTER' ? 'CLASS' : 'DOMAIN'}</span>
                <span className="field-value">
                  {sheetClass?.label} <small className="dim">{sheetClass?.labelKo}</small>
                </span>
              </div>
              {sheet.side === 'HUNTER' && (
                <div className="field">
                  <span className="field-label">AFFILIATION</span>
                  <span className={`tag ${sheet.affiliation === 'GOVERNMENT' ? 'blue' : 'gold'}`}>
                    {sheet.affiliation === 'GOVERNMENT' ? 'GOVERNMENT' : 'PRIVATE GUILD'}
                  </span>
                </div>
              )}
            </div>

            <div>
              <h3 className="sub-title">STATS</h3>
              <ul className="stat-summary">
                {statsFor(sheet.side).map((stat) => (
                  <li key={stat.key}>
                    <span className="field-label">{stat.label}</span>
                    <span className="num">{sheet.stats[stat.key] ?? POINT_BUY.baseValue}</span>
                    <small className="dim">{stat.labelKo}</small>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="sub-title">COMBAT VALUE</h3>
              {hunter && (
                <ul className="stat-summary">
                  <li>
                    <span className="field-label">MAX HP</span>
                    <span className="num">{hunter.maxHp}</span>
                  </li>
                  <li>
                    <span className="field-label">ATTACK</span>
                    <span className="num">{hunter.attack}</span>
                  </li>
                  <li>
                    <span className="field-label">DEFENSE</span>
                    <span className="num">{hunter.defense}</span>
                  </li>
                  <li>
                    <span className="field-label">MAX AP</span>
                    <span className="num">{hunter.maxAp}</span>
                  </li>
                </ul>
              )}
              {constellation && (
                <ul className="stat-summary">
                  <li>
                    <span className="field-label">POWER</span>
                    <span className="num">×{constellation.power}</span>
                  </li>
                  <li>
                    <span className="field-label">MAX AP</span>
                    <span className="num">{constellation.maxAp}</span>
                  </li>
                </ul>
              )}
            </div>
          </div>

          {(sheet.skills ?? []).length > 0 && (
            <>
              <h3 className="sub-title">CUSTOM SKILL</h3>
              <ul className="skill-summary">
                {sheet.skills.map((skill) => (
                  <li key={skill.id}>
                    <b>{skill.name}</b>
                    <span className="tag">{findSkillKind(skill.kind)?.labelKo ?? skill.kind}</span>
                    <span className="num">AP {skill.apCost}</span>
                    <span className="num">수치 {skill.power}</span>
                    <span className="num">
                      쿨 {skill.cooldown}R
                      {skill.maxUses !== null ? ` · ${skill.maxUses}회` : ''}
                    </span>
                    {skill.applyStatusIds.map((defId) => (
                      <span key={defId} className="tag warn">
                        {selectableStatuses().find((row) => row.id === defId)?.label ?? defId}
                      </span>
                    ))}
                    {skill.description && <small className="dim">{skill.description}</small>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {sheet.concept && (
            <>
              <h3 className="sub-title">CONCEPT</h3>
              <p className="concept-text">{sheet.concept}</p>
            </>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title">DEPLOY</h2>
          <p className="hint" style={{ marginBottom: 12 }}>
            전투 단말에 접속하면 이 시트에서 파생된 수치로 페어가 편성됩니다.
            페어 상대는 전투 단말에서 선택합니다.
          </p>
          <a className="confirm-btn" href={battleUrl()}>
            CONNECT TO RAID CONTROL
            <small>전투 단말로 이동</small>
          </a>
        </section>
      </div>
    );
  }

  /* ── 로그인 / 등록 화면 ───────────────────────────── */
  return (
    <div className="console">
      <header className="console-head">
        <div className="agency">
          <b>HUNTER MANAGEMENT AGENCY</b>
          <span>CONTRACT REGISTRY · 계약자 등록</span>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className={`ctl ${mode === 'LOGIN' ? 'on' : ''}`}
            onClick={() => setMode('LOGIN')}
          >
            LOG IN
          </button>
          <button
            type="button"
            className={`ctl ${mode === 'REGISTER' ? 'on' : ''}`}
            onClick={() => setMode('REGISTER')}
          >
            REGISTER
          </button>
        </div>
      </header>

      {isServerMode() ? (
        <p className="notice ok">
          <b>SERVER CONNECTED</b> — 계정과 캐릭터 시트가 서버에 저장됩니다. 다른 기기에서도 같은
          활동명으로 접속할 수 있습니다. 페어 편성은 관리국(운영진)이 진행합니다.
        </p>
      ) : (
        <p className="notice warn">
          <b>LOCAL MODE</b> — 이 단계의 계정은 <b>이 브라우저에만</b> 저장됩니다. 서버 인증이
          아니므로 다른 기기에서는 조회되지 않고, 브라우저 데이터를 지우면 시트도 사라집니다.
        </p>
      )}

      {errors.length > 0 && (
        <ul className="notice error">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      {message && <p className="notice ok">{message}</p>}

      {mode === 'LOGIN' ? (
        <section className="panel form">
          <h2 className="panel-title">LOG IN</h2>
          <label className="input-row">
            <span className="field-label">활동명</span>
            <input
              className="ctl input"
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
              autoComplete="username"
            />
          </label>
          <label className="input-row">
            <span className="field-label">비밀번호</span>
            <input
              className="ctl input"
              type="password"
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button
            type="button"
            className="confirm-btn"
            disabled={busy || !loginId || !loginPassword}
            onClick={submitLogin}
          >
            CONNECT
          </button>
        </section>
      ) : (
        <>
          {/* 역할 선택 */}
          <section className="panel">
            <h2 className="panel-title">ROLE</h2>
            <div className="role-grid">
              {(['HUNTER', 'CONSTELLATION'] as ActorSide[]).map((side) => (
                <button
                  key={side}
                  type="button"
                  className={`role-card ${draft.side === side ? 'selected' : ''}`}
                  onClick={() => setSide(side)}
                >
                  <b>{side}</b>
                  <span>{side === 'HUNTER' ? '헌터' : '성좌'}</span>
                  <p className="dim">
                    {side === 'HUNTER'
                      ? '탑 안에서 직접 싸운다. HP 를 가지고 전선에 선다.'
                      : '탑 밖에서 권능과 계시를 내린다. HP 대신 존재 상태를 가진다.'}
                  </p>
                </button>
              ))}
            </div>
            <p className="hint">역할을 바꾸면 스탯과 클래스 선택이 초기화됩니다.</p>
          </section>

          {/* 계정 */}
          <section className="panel form">
            <h2 className="panel-title">ACCOUNT</h2>
            <label className="input-row">
              <span className="field-label">활동명</span>
              <input
                className="ctl input"
                value={registerId}
                onChange={(event) => setRegisterId(event.target.value)}
                placeholder="2자 이상"
                autoComplete="username"
              />
            </label>
            <label className="input-row">
              <span className="field-label">비밀번호</span>
              <input
                className="ctl input"
                type="password"
                value={registerPassword}
                onChange={(event) => setRegisterPassword(event.target.value)}
                placeholder="4자 이상"
                autoComplete="new-password"
              />
            </label>
          </section>

          {/* 캐릭터 시트 */}
          <section className="panel form">
            <h2 className="panel-title">CHARACTER SHEET</h2>
            <label className="input-row">
              <span className="field-label">{draft.side === 'HUNTER' ? '이름' : '성호'}</span>
              <input
                className="ctl input"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder={draft.side === 'HUNTER' ? '예: 서윤' : '예: 겨울을 삼킨 별'}
              />
            </label>

            {draft.side === 'HUNTER' && (
              <div className="input-row">
                <span className="field-label">소속</span>
                <div className="btn-row">
                  {(['GOVERNMENT', 'PRIVATE_GUILD'] as Affiliation[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`ctl ${draft.affiliation === value ? 'on' : ''}`}
                      onClick={() => setDraft({ ...draft, affiliation: value })}
                    >
                      {value === 'GOVERNMENT' ? 'GOVERNMENT · 정부' : 'PRIVATE GUILD · 민간 길드'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <h3 className="sub-title">{draft.side === 'HUNTER' ? 'CLASS' : 'DOMAIN'}</h3>
            <div className="class-grid">
              {classes.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`class-card ${draft.classId === row.id ? 'selected' : ''}`}
                  onClick={() => setDraft({ ...draft, classId: row.id })}
                >
                  <div className="class-head">
                    <b>{row.label}</b>
                    <span className="dim">{row.labelKo}</span>
                  </div>
                  <p className="dim">{row.description}</p>
                  <ul className="class-bonus">
                    {row.bonus.attack ? <li>공격력 {fmt(row.bonus.attack)}</li> : null}
                    {row.bonus.maxHp ? <li>최대 HP {fmt(row.bonus.maxHp)}</li> : null}
                    {row.bonus.defense ? <li>방어력 {fmt(row.bonus.defense)}</li> : null}
                    {row.bonus.maxAp ? <li>최대 행동력 {fmt(row.bonus.maxAp)}</li> : null}
                    {row.bonus.power ? <li>권능 배율 +{Math.round(row.bonus.power * 100)}%</li> : null}
                  </ul>
                  <p className="class-focus">
                    주력 스탯{' '}
                    {row.focus
                      .map((key) => statsFor(draft.side).find((s) => s.key === key)?.labelKo ?? key)
                      .join(' · ')}
                  </p>
                  {row.pending && <span className="tag warn">{row.pending}</span>}
                </button>
              ))}
            </div>

            <h3 className="sub-title">
              STAT ALLOCATION
              <span className={`points ${remaining === 0 ? 'ok' : remaining < 0 ? 'over' : ''}`}>
                남은 포인트 {remaining} / {POINT_BUY.freePoints}
              </span>
            </h3>
            <div className="stat-list">
              {stats.map((stat) => (
                <StatRow
                  key={stat.key}
                  statKey={stat.key}
                  label={stat.label}
                  labelKo={stat.labelKo}
                  effect={stat.effect}
                  activeFrom={stat.activeFrom}
                  value={draft.stats[stat.key] ?? POINT_BUY.baseValue}
                  canIncrease={remaining > 0}
                  onChange={changeStat}
                />
              ))}
            </div>

            <h3 className="sub-title">DERIVED COMBAT VALUE</h3>
            <ul className="stat-summary derived">
              {derivedHunter && (
                <>
                  <li>
                    <span className="field-label">MAX HP</span>
                    <span className="num">{derivedHunter.maxHp}</span>
                  </li>
                  <li>
                    <span className="field-label">ATTACK</span>
                    <span className="num">{derivedHunter.attack}</span>
                  </li>
                  <li>
                    <span className="field-label">DEFENSE</span>
                    <span className="num">{derivedHunter.defense}</span>
                  </li>
                  <li>
                    <span className="field-label">MAX AP</span>
                    <span className="num">{derivedHunter.maxAp}</span>
                  </li>
                </>
              )}
              {derivedConstellation && (
                <>
                  <li>
                    <span className="field-label">POWER</span>
                    <span className="num">×{derivedConstellation.power}</span>
                  </li>
                  <li>
                    <span className="field-label">MAX AP</span>
                    <span className="num">{derivedConstellation.maxAp}</span>
                  </li>
                </>
              )}
            </ul>
            {!selectedClass && (
              <p className="hint">
                {draft.side === 'HUNTER' ? '클래스' : '권역'}를 선택하면 보정이 반영됩니다.
              </p>
            )}

            <h3 className="sub-title">
              CUSTOM SKILL
              <span className="points">
                {draft.skills.length} / {SKILL_RULES.maxSkills}
              </span>
            </h3>
            <SkillEditor
              side={draft.side}
              skills={draft.skills}
              onChange={(skills) => setDraft({ ...draft, skills })}
            />

            <h3 className="sub-title">CONCEPT</h3>
            <textarea
              className="ctl input textarea"
              rows={4}
              value={draft.concept}
              onChange={(event) => setDraft({ ...draft, concept: event.target.value })}
              placeholder="성격, 계약 경위, 탑에 오르는 이유 등 (선택 · 400자 이내)"
            />
          </section>

          <section className="panel confirm">
            <button
              type="button"
              className="confirm-btn"
              disabled={busy || !registerId || !registerPassword}
              onClick={submitRegister}
            >
              REGISTER CONTRACT
              <small>등록 후 전투 단말로 이동할 수 있습니다</small>
            </button>
          </section>
        </>
      )}
    </div>
  );
}

function fmt(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
