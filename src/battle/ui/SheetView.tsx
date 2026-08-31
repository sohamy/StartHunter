/**
 * 시트 표시 컴포넌트 — 운영진 화면에서 재사용한다.
 *
 * 운영진은 판정할 때 시트를 봐야 한다. 스탯이 몇인지, 커스텀 스킬의 특수 효과가
 * 무엇인지 모르면 기믹 판정도 연출도 쓸 수 없다. 그래서 시트 원본(CharacterSheet)과
 * 전투 중 런타임 스킬(SkillRuntime) 을 같은 형태로 보여준다.
 */

import type { ReactNode } from 'react';

import {
  PROFILE_FIELDS,
  POINT_BUY,
  findClass,
  hasProfile,
  statsFor,
  toProfile,
} from '../config/characters';
import { findSkillKind } from '../config/skills';
import { STATUS_DEFINITIONS } from '../config/status';
import { deriveConstellation, deriveHunter } from '../engine/character';
import { Portrait } from './PortraitField';
import type { PublicProfile } from '../store';
import type {
  ActorSide,
  Affiliation,
  CharacterSheet,
  PublicSkill,
  SheetProfile,
  SkillDefinition,
  SkillRuntime,
  StatBlock,
} from '../types';

type AnySkill = SkillDefinition | SkillRuntime;

function statusLabel(defId: string): string {
  return STATUS_DEFINITIONS.find((row) => row.id === defId)?.label ?? defId;
}

/** 전투 중 스킬만 쿨타임과 남은 횟수를 들고 있다 */
function isRuntime(skill: AnySkill): skill is SkillRuntime {
  return 'currentCooldown' in skill;
}

export function sideLabel(side: ActorSide): string {
  return side === 'HUNTER' ? '헌터' : '성좌';
}

/** 스탯 한 줄 — 카드 안에 끼워 넣는 압축 표기 */
export function StatLine({ side, stats }: { side: ActorSide; stats: StatBlock }) {
  return (
    <ul className="stat-line">
      {statsFor(side).map((stat) => (
        <li key={stat.key} title={`${stat.labelKo} — ${stat.effect}`}>
          <i>{stat.label}</i>
          <b className="num">{stats[stat.key] ?? POINT_BUY.baseValue}</b>
        </li>
      ))}
    </ul>
  );
}

/** 스킬 목록. 전투 중이면 쿨타임 · 남은 횟수까지 붙는다. */
export function SkillList({ skills }: { skills: AnySkill[] }) {
  if (skills.length === 0) {
    return <p className="dim small-text">등록된 스킬 없음 — 기본 행동만 사용합니다.</p>;
  }

  return (
    <ul className="skill-summary">
      {skills.map((skill) => (
        <li key={skill.id}>
          <b>{skill.name || '(이름 없음)'}</b>
          <span className="tag">{findSkillKind(skill.kind)?.labelKo ?? skill.kind}</span>
          <span className="num">AP {skill.apCost}</span>
          <span className="num">수치 {skill.power}</span>
          <span className="num dim">
            쿨 {skill.cooldown}R · {skill.maxUses === null ? '무제한' : `${skill.maxUses}회`}
          </span>
          {isRuntime(skill) && (
            <>
              {skill.currentCooldown > 0 && (
                <span className="tag warn">대기 {skill.currentCooldown}R</span>
              )}
              {skill.remainingUses !== null && (
                <span className={`tag ${skill.remainingUses > 0 ? 'ok' : 'critical'}`}>
                  남은 {skill.remainingUses}회
                </span>
              )}
            </>
          )}
          {skill.applyStatusIds.map((defId) => (
            <span key={defId} className="tag warn">
              {statusLabel(defId)}
            </span>
          ))}
          {skill.description && <small className="dim">{skill.description}</small>}
          {/* 수치로 표현되지 않는 효과 — 운영진이 직접 판정해야 하는 부분 */}
          {skill.special && <small className="gold">판정 필요 · {skill.special}</small>}
        </li>
      ))}
    </ul>
  );
}

export function affiliationLabel(affiliation: Affiliation): string {
  return affiliation === 'GOVERNMENT' ? '정부' : '민간 길드';
}

/**
 * 컨셉 서술 — 성격 · 특징 · 계약 경위.
 * 비어 있는 칸은 그리지 않는다. 세 칸이 모두 비면 아무것도 그리지 않는다.
 */
export function ProfileBlock({
  source,
  compact,
}: {
  source: Partial<SheetProfile> | null | undefined;
  /** 카드 안에 들어갈 때 — 제목을 작게 줄인다 */
  compact?: boolean;
}) {
  const profile = toProfile(source ?? {});
  if (!hasProfile(profile)) return null;

  return (
    <div className={`profile-block ${compact ? 'compact' : ''}`}>
      {PROFILE_FIELDS.filter((field) => profile[field.key].trim().length > 0).map((field) => (
        <section key={field.key} className="profile-part">
          <h4 className="profile-part-title">
            <span>{field.labelKo}</span>
            <i>{field.label}</i>
          </h4>
          <p className="concept-text">{profile[field.key]}</p>
        </section>
      ))}
    </div>
  );
}

/** 공개 스킬 — 이름 · 종류 · 설명까지만. 수치는 운영진 화면에서만 보인다. */
export function PublicSkillList({ skills }: { skills: PublicSkill[] }) {
  if (skills.length === 0) {
    return <p className="dim small-text">등록된 스킬 없음 — 기본 행동만 사용합니다.</p>;
  }

  return (
    <ul className="skill-summary public">
      {skills.map((skill) => (
        <li key={skill.id}>
          <b>{skill.name || '(이름 없음)'}</b>
          <span className="tag">{findSkillKind(skill.kind)?.labelKo ?? skill.kind}</span>
          {skill.description && <small className="dim">{skill.description}</small>}
        </li>
      ))}
    </ul>
  );
}

/** 스탯 → 전투 수치 환산. 시트만 보고 전투 능력을 가늠할 수 있게 한다. */
function DerivedValues({ sheet }: { sheet: CharacterSheet }) {
  if (sheet.side === 'HUNTER') {
    const derived = deriveHunter(sheet);
    return (
      <ul className="stat-line">
        <li>
          <i>HP</i>
          <b className="num">{derived.maxHp}</b>
        </li>
        <li>
          <i>ATK</i>
          <b className="num">{derived.attack}</b>
        </li>
        <li>
          <i>DEF</i>
          <b className="num">{derived.defense}</b>
        </li>
        <li>
          <i>AP</i>
          <b className="num">{derived.maxAp}</b>
        </li>
      </ul>
    );
  }

  const derived = deriveConstellation(sheet);
  return (
    <ul className="stat-line">
      <li>
        <i>권능</i>
        <b className="num gold">×{derived.power}</b>
      </li>
      <li>
        <i>AP</i>
        <b className="num">{derived.maxAp}</b>
      </li>
    </ul>
  );
}

/**
 * 전투 중 시트 — 런타임 상태에서 그린다.
 *
 * 전투가 시작되면 수치는 전투 상태 쪽이 원본이다(운영진이 고칠 수 있다).
 * 그래서 시트 파일을 다시 읽지 않고 HunterState / ConstellationState 를 그대로 쓴다.
 */
export function ActorSheet({
  side,
  name,
  classId,
  stats,
  skills,
  accountId,
  profile,
  portrait,
  badge,
}: {
  side: ActorSide;
  name: string;
  classId: string | null;
  stats: StatBlock;
  skills: SkillRuntime[];
  accountId?: string | null;
  /** 컨셉 서술 — 전투 상태에는 없으므로 시트 쪽에서 받아 온다 */
  profile?: Partial<SheetProfile> | null;
  /** 캐릭터 사진 — 전투 상태에는 없으므로 시트 쪽에서 받아 온다 */
  portrait?: string | null;
  /** 제목 줄에 붙일 표시 (내 캐릭터 · 소속 페어 등) */
  badge?: ReactNode;
}) {
  const classDef = findClass(side, classId);

  return (
    <article className={`sheet-card ${side === 'HUNTER' ? 'hunter' : 'constellation'}`}>
      <header className="sheet-card-head">
        <Portrait src={portrait} name={name} size="sm" />
        <span className={`tag ${side === 'HUNTER' ? 'blue' : 'gold'}`}>{sideLabel(side)}</span>
        <b>{name}</b>
        {classDef && (
          <span className="dim small-text">
            {classDef.label} · {classDef.labelKo}
          </span>
        )}
        {accountId && <span className="field-label">@{accountId}</span>}
        {badge}
      </header>

      <div className="sheet-card-row">
        <span className="field-label">스탯</span>
        <StatLine side={side} stats={stats} />
      </div>

      <div className="sheet-card-row block">
        <span className="field-label">스킬 {skills.length}</span>
        <SkillList skills={skills} />
      </div>

      {hasProfile(profile) && (
        <div className="sheet-card-row block">
          <span className="field-label">컨셉</span>
          <ProfileBlock source={profile} compact />
        </div>
      )}
    </article>
  );
}

/**
 * 시트 전문 한 장.
 *
 * @param accountId 활동명. 편성 · 채팅에서 쓰는 식별자라 함께 보여준다.
 * @param note      제목 줄 오른쪽에 붙일 추가 표시 (페어 소속 등)
 */
export function SheetDetail({
  sheet,
  accountId,
  note,
}: {
  sheet: CharacterSheet;
  accountId?: string;
  note?: ReactNode;
}) {
  const classDef = findClass(sheet.side, sheet.classId);

  return (
    <article className={`sheet-card ${sheet.side === 'HUNTER' ? 'hunter' : 'constellation'}`}>
      <header className="sheet-card-head">
        <Portrait src={sheet.portrait} name={sheet.name} size="sm" />
        <span className={`tag ${sheet.side === 'HUNTER' ? 'blue' : 'gold'}`}>
          {sideLabel(sheet.side)}
        </span>
        <b>{sheet.name}</b>
        <span className="dim small-text">
          {classDef ? `${classDef.label} · ${classDef.labelKo}` : `미지정 (${sheet.classId})`}
        </span>
        {sheet.side === 'HUNTER' && (
          <span className={`tag ${sheet.affiliation === 'GOVERNMENT' ? 'blue' : 'gold'}`}>
            {sheet.affiliation === 'GOVERNMENT' ? '정부' : '민간 길드'}
          </span>
        )}
        {accountId && <span className="field-label">@{accountId}</span>}
        {note}
      </header>

      <div className="sheet-card-row">
        <span className="field-label">스탯</span>
        <StatLine side={sheet.side} stats={sheet.stats} />
      </div>
      <div className="sheet-card-row">
        <span className="field-label">환산</span>
        <DerivedValues sheet={sheet} />
      </div>

      <div className="sheet-card-row block">
        <span className="field-label">스킬 {(sheet.skills ?? []).length}</span>
        <SkillList skills={sheet.skills ?? []} />
      </div>

      {sheet.partnerName.trim().length > 0 && (
        <div className="sheet-card-row">
          <span className="field-label">계약 상대</span>
          <span>{sheet.partnerName}</span>
        </div>
      )}

      {hasProfile(sheet) && (
        <div className="sheet-card-row block">
          <span className="field-label">컨셉</span>
          <ProfileBlock source={sheet} compact />
        </div>
      )}
    </article>
  );
}

/**
 * 공개 시트 한 장 — 다른 참가자에게 보이는 범위만 담는다.
 *
 * 여기에 들어오는 값은 store 의 toPublicProfile 을 이미 거쳤다.
 * 즉 스탯도 스킬 수치도 애초에 없으므로, 실수로 새어 나갈 자리가 없다.
 *
 * 헌터와 성좌는 같은 정보를 다른 서식으로 낸다.
 *  · 헌터 — 관리국이 발급한 인사 기록부. 모서리 괄호, 일련번호, 격자 바탕.
 *  · 성좌 — 천문대가 옮겨 적은 성록(星錄). 별 바탕, 이중 괘선, ✦ 구획선.
 * 한 명당 한 장이며, 서술은 잘리지 않고 전문이 실린다.
 */
export function PublicSheetCard({
  profile,
  badge,
  partnerName,
}: {
  profile: PublicProfile;
  badge?: ReactNode;
  /** 편성이 확정된 경우의 상대 이름 — 참가자가 적어 둔 값보다 우선한다 */
  partnerName?: string | null;
}) {
  const hunter = profile.side === 'HUNTER';
  const classDef = findClass(profile.side, profile.classId);
  const partner = (partnerName ?? '').trim() || profile.partnerName.trim();
  const filled = PROFILE_FIELDS.filter((field) => (profile[field.key] ?? '').trim().length > 0);

  return (
    <article className={`dossier ${hunter ? 'hunter' : 'constellation'}`}>
      <span className="dossier-frame" aria-hidden="true" />

      <header className="dossier-top">
        <span className="dossier-stamp">{hunter ? 'HUNTER FILE' : 'STELLAR RECORD'}</span>
        <span className="dossier-serial">
          {hunter ? 'FILE NO.' : '星錄 NO.'} {profile.accountId}
        </span>
      </header>

      <div className="dossier-id">
        <Portrait src={profile.portrait} name={profile.name} size="lg" />
        <div className="dossier-titles">
          <span className="dossier-eyebrow">
            {classDef ? classDef.label : hunter ? 'UNCLASSIFIED' : 'UNCHARTED'}
          </span>
          <b className="dossier-name">{profile.name || '(이름 없음)'}</b>
          <span className="dossier-sub">
            {classDef ? classDef.labelKo : '미지정'} · {sideLabel(profile.side)}
          </span>
          <div className="dossier-tags">
            <span className={`tag ${hunter ? 'blue' : 'gold'}`}>
              {affiliationLabel(profile.affiliation)}
            </span>
            {badge}
          </div>
        </div>
      </div>

      <dl className="dossier-facts">
        <div>
          <dt>계약 상대</dt>
          <dd className={partner ? '' : 'dim'}>{partner || '미정 — 공란'}</dd>
        </div>
        <div>
          <dt>활동명</dt>
          <dd>@{profile.accountId}</dd>
        </div>
      </dl>

      <div className="dossier-body">
        {filled.map((field, index) => (
          <section key={field.key} className="dossier-part">
            <h4 className="dossier-part-title">
              <span className="dossier-index">{String(index + 1).padStart(2, '0')}</span>
              <span>{field.labelKo}</span>
              <i>{field.label}</i>
            </h4>
            <p className="concept-text">{profile[field.key]}</p>
          </section>
        ))}

        <section className="dossier-part">
          <h4 className="dossier-part-title">
            <span className="dossier-index">{String(filled.length + 1).padStart(2, '0')}</span>
            <span>보유 기술</span>
            <i>SKILL</i>
          </h4>
          <PublicSkillList skills={profile.skills} />
        </section>

        {filled.length === 0 && profile.skills.length === 0 && (
          <p className="dim small-text">아직 적어 둔 설정이 없습니다.</p>
        )}
      </div>

      <footer className="dossier-foot">
        <span>{hunter ? 'HUNTER MANAGEMENT AGENCY' : 'ASTRAL REGISTRY'}</span>
        <span>공개 등록 정보 — 스탯 · 스킬 수치는 관리국 열람</span>
      </footer>
    </article>
  );
}
