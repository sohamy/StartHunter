/**
 * 계약 등록 단말 — 로그인 · 회원가입(캐릭터 시트 작성).
 *
 * 회원가입이 곧 캐릭터 시트 작성이다.
 * 스탯 배분 결과가 전투 수치로 어떻게 환산되는지 화면에서 바로 보여준다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  POINT_BUY,
  PROFILE_FIELDS,
  SHEET_DISCLOSURE,
  classesFor,
  describeTraits,
  findClass,
  hasProfile,
  initialStats,
  remainingPoints,
  statsFor,
} from '../config/characters';
import { CURRENT_PHASE } from '../config/rules';
import { SKILL_RULES, blankSkill, findSkillKind, skillKindsFor } from '../config/skills';
import { selectableStatuses } from '../config/status';
import { deriveConstellation, deriveHunter, validateSheet } from '../engine/character';
import {
  AuthError,
  getAuth,
  getServerAuth,
  getStorage,
  isServerMode,
  toPublicProfile,
  type PublicProfile,
} from '../store';
import PortraitField, { Portrait } from './PortraitField';
import { ProfileBlock, PublicSheetCard } from './SheetView';
import type {
  Account,
  ActorSide,
  Affiliation,
  CharacterSheet,
  PairBond,
  SkillDefinition,
  StatBlock,
} from '../types';

type Mode = 'LOGIN' | 'REGISTER';

interface DraftSheet {
  side: ActorSide;
  name: string;
  partnerName: string;
  classId: string;
  stats: StatBlock;
  skills: SkillDefinition[];
  personality: string;
  traits: string;
  contractStory: string;
  portrait: string | null;
  affiliation: Affiliation;
}

function emptyDraft(side: ActorSide): DraftSheet {
  return {
    side,
    name: '',
    partnerName: '',
    classId: '',
    stats: initialStats(side),
    skills: [],
    personality: '',
    traits: '',
    contractStory: '',
    portrait: null,
    affiliation: 'GOVERNMENT',
  };
}

/** 배틀 페이지 경로 — base 경로를 반영한다 */
function battleUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/battle/`;
}

function controlUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/battle/control/`;
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
        {/* 이미 구현된 단계 번호는 띄우지 않는다 — 아직 반영되지 않은 것만 표시한다 */}
        {activeFrom > CURRENT_PHASE && <span className="tag warn">미반영</span>}
      </p>
    </div>
  );
}

/* ── 커스텀 스킬 편집기 ─────────────────────────────── */

/**
 * 슬라이더 한 칸.
 * 라벨과 현재값을 위 줄에 두고, 슬라이더는 그 아래 자기 줄을 차지한다.
 * 드롭다운과 나란히 놓일 때 서로 침범하지 않게 하기 위한 구조다.
 */
function SliderField({
  label,
  value,
  display,
  min,
  max,
  step = 1,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  hint?: string;
}) {
  return (
    <div className="slider-field">
      <div className="slider-head">
        <span className="field-label">{label}</span>
        <b className="num">{display}</b>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
      />
      <div className="slider-scale">
        <span>{min}</span>
        {hint && <span className="slider-hint">{hint}</span>}
        <span>{max}</span>
      </div>
    </div>
  );
}

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

            {/* 1행 — 이름과 종류 */}
            <div className="skill-row-top">
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
                      {row.activeFrom > CURRENT_PHASE ? ' (미반영)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* 2행 — 수치 조절. 드롭다운과 다른 줄에 둔다 */}
            <div className="skill-sliders">
              <SliderField
                label="행동력"
                value={skill.apCost}
                display={`AP ${skill.apCost}`}
                min={SKILL_RULES.apCost.min}
                max={SKILL_RULES.apCost.max}
                onChange={(value) => patch(index, { apCost: value })}
              />
              <SliderField
                label="기본 수치"
                value={skill.power}
                display={String(Math.round(skill.power * 10) / 10)}
                min={SKILL_RULES.power.min}
                max={SKILL_RULES.power.max}
                step={SKILL_RULES.power.step}
                onChange={(value) => patch(index, { power: Math.round(value * 10) / 10 })}
                hint={kindDef?.powerMeaning}
              />
              <SliderField
                label="쿨타임"
                value={skill.cooldown}
                display={skill.cooldown === 0 ? '없음' : `${skill.cooldown} 라운드`}
                min={SKILL_RULES.cooldown.min}
                max={SKILL_RULES.cooldown.max}
                onChange={(value) => patch(index, { cooldown: value })}
              />
              <SliderField
                label="전투당 사용"
                value={skill.maxUses ?? 0}
                display={skill.maxUses === null ? '무제한' : `${skill.maxUses}회`}
                min={SKILL_RULES.maxUses.min}
                max={SKILL_RULES.maxUses.max}
                onChange={(value) => patch(index, { maxUses: value === 0 ? null : value })}
                hint="0 = 무제한"
              />
            </div>

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
  const [operator, setOperator] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  /** 실패 안내는 화면 위쪽에 뜬다 — 폼이 길어서 스스로 보여 주지 않으면 못 본다 */
  const errorBox = useRef<HTMLUListElement>(null);

  const [loginId, setLoginId] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [registerId, setRegisterId] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [draft, setDraft] = useState<DraftSheet>(() => emptyDraft('HUNTER'));
  const [bond, setBond] = useState<PairBond | null>(null);
  /** 페어 상대의 공개 프로필 — 편성이 확정된 뒤에만 받아 온다 */
  const [partnerProfile, setPartnerProfile] = useState<PublicProfile | null>(null);

  // 이미 로그인된 세션이 있으면 시트 화면으로 바로 넘긴다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await auth.currentSession();
      if (!session || cancelled) return;

      // 세션이 이미 살아 있는 운영자는 작전실로 넘긴다.
      const server = getServerAuth();
      if (server && (await server.isOperator())) {
        if (cancelled) return;
        setOperator(true);
        window.location.href = controlUrl();
        return;
      }

      const found = await auth.getAccount(session.accountId);
      if (!cancelled && found) setAccount(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [auth]);

  /**
   * 확정된 편성을 찾아 온다.
   * 관리국이 페어를 맺어 주기 전에는 없다 — 그때는 시트에 적어 둔 이름을 대신 보여 준다.
   */
  useEffect(() => {
    if (!account) {
      setBond(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const bonds = await getStorage().listBonds();
        const mine = bonds.find(
          (row) =>
            row.active &&
            (row.hunterAccountId === account.id || row.constellationAccountId === account.id),
        );
        if (cancelled) return;
        setBond(mine ?? null);

        // 상대 한 명만 조회한다 — 전체 인원 목록은 관리국 화면에만 있다
        const partnerId =
          mine &&
          (mine.hunterAccountId === account.id
            ? mine.constellationAccountId
            : mine.hunterAccountId);
        setPartnerProfile(partnerId ? await auth.getPublicProfile(partnerId) : null);
      } catch {
        // 편성 조회 실패는 화면을 막을 이유가 아니다 — 시트는 그대로 보여 준다
        if (!cancelled) {
          setBond(null);
          setPartnerProfile(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, auth]);

  // 서버가 거절한 경우(활동명 중복 등)에만 뜬다. 폼이 길어서 스스로 보여 줘야 한다.
  useEffect(() => {
    if (errors.length === 0) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    errorBox.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  }, [errors]);

  const setSide = useCallback((side: ActorSide) => {
    // 쪽을 바꿔도 이미 적어 둔 서술은 남긴다 — 스탯과 클래스만 새로 고른다
    setDraft((current) => ({
      ...emptyDraft(side),
      name: current.name,
      partnerName: current.partnerName,
      personality: current.personality,
      traits: current.traits,
      contractStory: current.contractStory,
      portrait: current.portrait,
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

  /** 서버 모드는 Supabase 정책을 따른다 — 로컬 모드보다 길다 */
  const minPassword = isServerMode() ? 6 : 4;

  /**
   * 지금 등록을 막고 있는 것들.
   * 확정 버튼 바로 옆에 붙여 두어, 화면 위로 올라가지 않아도 알 수 있게 한다.
   */
  const blockers: string[] = [
    registerId.trim().length < 2 ? '활동명을 2자 이상 입력하세요.' : null,
    registerPassword.length < minPassword ? `비밀번호를 ${minPassword}자 이상 입력하세요.` : null,
    ...validateSheet(draft).map((issue) => issue.message),
  ].filter((row): row is string => row !== null);

  const submitRegister = async () => {
    setErrors([]);
    setMessage(null);
    // 막는 사유는 버튼 밑에 이미 떠 있다 — 화면 위로 끌고 올라가지 않는다
    if (blockers.length > 0) return;

    setBusy(true);
    try {
      const created = await auth.register({
        id: registerId,
        password: registerPassword,
        sheet: {
          side: draft.side,
          name: draft.name.trim(),
          partnerName: draft.partnerName.trim(),
          classId: draft.classId,
          stats: draft.stats,
          skills: draft.skills.map((skill) => ({ ...skill, name: skill.name.trim() })),
          personality: draft.personality.trim(),
          traits: draft.traits.trim(),
          contractStory: draft.contractStory.trim(),
          portrait: draft.portrait,
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

      // 운영자는 시트가 없을 수 있으므로 계정 조회보다 먼저 판정하고 작전실로 보낸다.
      const server = getServerAuth();
      if (server && (await server.isOperator())) {
        setMessage('운영자 계정 — 중앙 작전실로 이동합니다…');
        window.location.href = controlUrl();
        return;
      }

      const found = await auth.getAccount(session.accountId);
      if (!found) {
        setErrors([
          '이 계정에 등록된 캐릭터 시트가 없습니다. 운영자 계정이라면 작전실로 접속하세요.',
        ]);
        return;
      }
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

    // 편성이 확정됐으면 관리국이 맺어 준 상대가 우선, 아니면 시트에 적어 둔 이름
    const bondedName =
      sheet.side === 'HUNTER' ? bond?.constellationName : bond?.hunterName;
    const bondedHandle =
      sheet.side === 'HUNTER' ? bond?.constellationAccountId : bond?.hunterAccountId;
    const partnerName = (bondedName ?? '').trim() || sheet.partnerName.trim();

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
                <span className="field-label">PAIR</span>
                <span className={`field-value ${partnerName ? '' : 'dim'}`}>
                  {partnerName || '미정 — 공란'}
                  {bondedHandle && <small className="dim"> @{bondedHandle}</small>}
                </span>
              </div>
              {bond && (
                <div className="field">
                  <span className="field-label">SQUAD</span>
                  <span className="field-value">
                    {bond.label} <small className="dim">관리국 편성 확정</small>
                  </span>
                </div>
              )}
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
              <h3 className="sub-title">
                STATS <span className="tag sealed">관리국 전용</span>
              </h3>
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
              <h3 className="sub-title">
                COMBAT VALUE <span className="tag sealed">관리국 전용</span>
              </h3>
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
              <h3 className="sub-title">
                CUSTOM SKILL <span className="tag sealed">수치는 관리국 전용</span>
              </h3>
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

          {sheet.portrait && (
            <>
              <h3 className="sub-title">PORTRAIT</h3>
              <Portrait src={sheet.portrait} name={sheet.name} size="lg" />
            </>
          )}

          {hasProfile(sheet) && (
            <>
              <h3 className="sub-title">CONCEPT</h3>
              <ProfileBlock source={sheet} />
            </>
          )}
        </section>

        {/* 공개 시트 — 다른 참가자에게 보이는 그대로 */}
        <section className="panel">
          <h2 className="panel-title">PUBLIC DOSSIER · 공개 시트</h2>
          <p className="hint" style={{ marginBottom: 12 }}>
            다른 참가자에게는 아래 카드만 보입니다. 스탯과 스킬 수치는 관리국(운영진)만 열람합니다.
          </p>
          <PublicSheetCard
            profile={toPublicProfile(account.id, sheet)}
            partnerName={bondedName}
            badge={<span className="tag ok">내 시트</span>}
          />
          <div className="disclosure">
            <div>
              <h3 className="sub-title">공개되는 것</h3>
              <ul className="disclosure-list open">
                {SHEET_DISCLOSURE.public.map((row) => (
                  <li key={row}>{row}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="sub-title">관리국만 보는 것</h3>
              <ul className="disclosure-list sealed">
                {SHEET_DISCLOSURE.operatorOnly.map((row) => (
                  <li key={row}>{row}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {partnerProfile && (
          <section className="panel">
            <h2 className="panel-title">CONTRACTED PAIR · 계약 상대</h2>
            <p className="hint" style={{ marginBottom: 12 }}>
              관리국이 맺어 준 상대의 공개 시트입니다. 상대의 스탯과 스킬 수치는 열람할 수 없습니다.
            </p>
            <PublicSheetCard
              profile={partnerProfile}
              partnerName={sheet.name}
              badge={bond ? <span className="tag ok">{bond.label}</span> : undefined}
            />
          </section>
        )}

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

  if (operator) {
    return <div className="console-loading">OPERATOR CLEARANCE — REDIRECTING TO RAID CONTROL…</div>;
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
        <ul className="notice error" ref={errorBox} role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      {message && <p className="notice ok">{message}</p>}

      {mode === 'LOGIN' ? (
        /* section 이 아니라 form 이다 — Enter 제출과 비밀번호 저장 제안이 여기에 달려 있다 */
        <form
          className="panel form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitLogin();
          }}
        >
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
          <button type="submit" className="confirm-btn" disabled={busy || !loginId || !loginPassword}>
            CONNECT
          </button>
        </form>
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
                  className={`role-card ${side === 'HUNTER' ? 'hunter' : 'constellation'} ${
                    draft.side === side ? 'selected' : ''
                  }`}
                  onClick={() => setSide(side)}
                >
                  <b>{side}</b>
                  <span>{side === 'HUNTER' ? '헌터' : '성좌'}</span>
                  <p className="dim">
                    {side === 'HUNTER'
                      ? '문을 열고 먼저 들어간다. 무기를 들고 전선에 서며, HP 를 가진다.'
                      : '하늘에 남아 권능과 계시를 내린다. HP 대신 존재 상태를 가진다.'}
                  </p>
                </button>
              ))}
            </div>
            <p className="hint">역할을 바꾸면 스탯과 클래스 선택이 초기화됩니다.</p>
          </section>

          {/* 계정 — 아래 REGISTER 버튼이 form 속성으로 이 폼에 붙는다 */}
          <form
            id="register-form"
            className="panel form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitRegister();
            }}
          >
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
                placeholder={`${minPassword}자 이상`}
                autoComplete="new-password"
              />
            </label>
          </form>

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

            {/* 이미 짝을 정하고 온 참가자를 위한 칸 — 아직 없으면 비워 둔다 */}
            <label className="input-row">
              <span className="field-label">
                {draft.side === 'HUNTER' ? '계약한 성좌' : '계약한 헌터'}
              </span>
              <input
                className="ctl input"
                value={draft.partnerName}
                onChange={(event) => setDraft({ ...draft, partnerName: event.target.value })}
                placeholder="상대 페어 이름 — 아직 없으면 공란으로 두세요"
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
                    {describeTraits(row.traits).map((line) => (
                      <li key={line} className="gold">
                        {line}
                      </li>
                    ))}
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

            <h3 className="sub-title">PORTRAIT</h3>
            <PortraitField
              value={draft.portrait}
              name={draft.name}
              onChange={(portrait) => setDraft({ ...draft, portrait })}
              label={draft.side === 'HUNTER' ? '헌터 사진' : '성좌 사진'}
            />

            <h3 className="sub-title">CONCEPT</h3>
            <p className="hint" style={{ marginBottom: 10 }}>
              세 칸 모두 선택입니다. 적어 둔 내용은 다른 참가자에게도 공개됩니다.
            </p>
            {PROFILE_FIELDS.map((field) => {
              const value = draft[field.key];
              const over = value.trim().length > field.maxChars;
              return (
                <div key={field.key} className="profile-field">
                  <div className="profile-field-head">
                    <span className="field-label">
                      {field.label} <small className="dim">{field.labelKo}</small>
                    </span>
                    <span className={`num small-text ${over ? 'danger-text' : 'dim'}`}>
                      {value.length} / {field.maxChars}
                    </span>
                  </div>
                  <textarea
                    className="ctl input textarea"
                    rows={field.rows}
                    value={value}
                    onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                    placeholder={field.placeholder}
                  />
                  <p className="hint">{field.hint}</p>
                </div>
              );
            })}
          </section>

          <section className="panel confirm">
            <button
              type="submit"
              form="register-form"
              className="confirm-btn"
              disabled={busy || blockers.length > 0}
            >
              REGISTER CONTRACT
              <small>
                {blockers.length > 0
                  ? `남은 항목 ${blockers.length}개 — 아래 목록을 채우면 열립니다`
                  : '등록 후 전투 단말로 이동할 수 있습니다'}
              </small>
            </button>
            {/* 화면 위 알림까지 올라가지 않아도 되도록, 막고 있는 것을 버튼 밑에 둔다 */}
            {blockers.length > 0 && (
              <ul className="notice warn" style={{ marginTop: 12 }}>
                {blockers.map((row) => (
                  <li key={row}>{row}</li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function fmt(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
