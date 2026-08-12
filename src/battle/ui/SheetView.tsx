/**
 * 시트 표시 컴포넌트 — 운영진 화면에서 재사용한다.
 *
 * 운영진은 판정할 때 시트를 봐야 한다. 스탯이 몇인지, 커스텀 스킬의 특수 효과가
 * 무엇인지 모르면 기믹 판정도 연출도 쓸 수 없다. 그래서 시트 원본(CharacterSheet)과
 * 전투 중 런타임 스킬(SkillRuntime) 을 같은 형태로 보여준다.
 */

import type { ReactNode } from 'react';

import { POINT_BUY, findClass, statsFor } from '../config/characters';
import { findSkillKind } from '../config/skills';
import { STATUS_DEFINITIONS } from '../config/status';
import { deriveConstellation, deriveHunter } from '../engine/character';
import type {
  ActorSide,
  CharacterSheet,
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
  concept,
  badge,
}: {
  side: ActorSide;
  name: string;
  classId: string | null;
  stats: StatBlock;
  skills: SkillRuntime[];
  accountId?: string | null;
  concept?: string;
  /** 제목 줄에 붙일 표시 (내 캐릭터 · 소속 페어 등) */
  badge?: ReactNode;
}) {
  const classDef = findClass(side, classId);

  return (
    <article className={`sheet-card ${side === 'HUNTER' ? 'hunter' : 'constellation'}`}>
      <header className="sheet-card-head">
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

      {concept && (
        <div className="sheet-card-row block">
          <span className="field-label">컨셉</span>
          <p className="concept-text">{concept}</p>
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

      {sheet.concept && (
        <div className="sheet-card-row block">
          <span className="field-label">컨셉</span>
          <p className="concept-text">{sheet.concept}</p>
        </div>
      )}
    </article>
  );
}
