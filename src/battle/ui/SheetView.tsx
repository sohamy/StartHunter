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
import { ITEM_CATEGORY_LABELS, describeItem, findItem } from '../config/items';
import { findSkillKind } from '../config/skills';
import { STATUS_DEFINITIONS } from '../config/status';
import { deriveConstellation, deriveHunter } from '../engine/character';
import { Portrait } from './PortraitField';
import type { PublicPair, PublicProfile } from '../store';
import type {
  ActorSide,
  Affiliation,
  CharacterSheet,
  ItemStack,
  SheetProfile,
  SkillDefinition,
  SkillRuntime,
  StatBlock,
} from '../types';

/**
 * 소지금과 가방 — **개인 소유**다. 시트에 붙어 다니며 페어와 나누지 않는다.
 * 전투에 들어갈 때도 각자 자기 가방을 들고 들어간다.
 */
export interface Supply {
  points: number;
  inventory: ItemStack[];
}

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

/**
 * 소지금과 가방 — 개인 것이다.
 *
 * 여기서는 사고 팔 수 없다 — 구매와 반납은 관리국 보급 창구(작전실)에서 처리한다.
 */
export function SupplyBlock({ supply }: { supply: Supply }) {
  const stacks = (supply.inventory ?? []).filter((stack) => stack.quantity > 0);

  return (
    <div className="supply-block">
      <div className="supply-points">
        <span className="purse-coin" aria-hidden="true">
          ◈
        </span>
        <span className="purse-body">
          <span className="field-label">소지금 · CREDIT</span>
          <b className="num gold">{(supply.points ?? 0).toLocaleString()} P</b>
        </span>
        <span className="tag">개인 소유</span>
        <span className="purse-slots num dim">가방 {stacks.length} / 종</span>
      </div>

      {stacks.length === 0 ? (
        <p className="dim small-text">가방이 비어 있습니다 — 보급은 관리국 창구에서 받습니다.</p>
      ) : (
        <ul className="inventory-grid">
          {stacks.map((stack) => {
            const item = findItem(stack.itemId);
            if (!item) return null;
            const effects = describeItem(item);
            return (
              <li
                key={stack.itemId}
                className={`slot cat-${item.category.toLowerCase()}`}
                title={`${item.nameKo} — ${effects.join(' / ') || item.description}`}
              >
                <span className="slot-count num">×{stack.quantity}</span>
                <span className="slot-name">{item.nameKo}</span>
                <span className="slot-cat">{ITEM_CATEGORY_LABELS[item.category].labelKo}</span>
                <span className="slot-effect">{effects[0] ?? item.description}</span>
                <span className="slot-ap num">AP {item.apCost}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ── 게임 스탯 창 ───────────────────────────────────────
   숫자만 늘어놓으면 어느 쪽이 센지 한눈에 안 들어온다.
   도형 하나 · 게이지 · 환산 타일 세 겹으로 보여 준다.

   오각형은 두 쪽 모두에게 맞는다 —
   헌터는 단말이 훑고 지나간 스캔 도형, 성좌는 별자리 그 자체다. */

/** 오각(또는 N각) 레이더. 라이브러리 없이 그린다 — 축 개수는 스탯 정의를 따른다. */
export function StatRadar({
  side,
  stats,
  size = 190,
}: {
  side: ActorSide;
  stats: StatBlock;
  size?: number;
}) {
  const axes = statsFor(side);
  if (axes.length < 3) return null;

  const center = size / 2;
  const radius = center - 30;
  const max = POINT_BUY.maxValue;
  const rings = [0.25, 0.5, 0.75, 1];

  /** 12시에서 시작해 시계 방향 */
  const point = (index: number, ratio: number) => {
    const angle = (Math.PI * 2 * index) / axes.length - Math.PI / 2;
    return [center + Math.cos(angle) * radius * ratio, center + Math.sin(angle) * radius * ratio];
  };

  const polygon = (ratio: number) =>
    axes.map((_, index) => point(index, ratio).join(',')).join(' ');

  const shape = axes
    .map((axis, index) => {
      const value = stats[axis.key] ?? POINT_BUY.baseValue;
      return point(index, Math.max(0.08, value / max)).join(',');
    })
    .join(' ');

  return (
    <svg
      className="stat-radar"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={axes
        .map((axis) => `${axis.labelKo} ${stats[axis.key] ?? POINT_BUY.baseValue}`)
        .join(', ')}
    >
      {/* 거미줄 */}
      {rings.map((ratio) => (
        <polygon key={ratio} className="radar-ring" points={polygon(ratio)} />
      ))}
      {axes.map((axis, index) => {
        const [x, y] = point(index, 1);
        return <line key={axis.key} className="radar-spoke" x1={center} y1={center} x2={x} y2={y} />;
      })}

      {/* 값 */}
      <polygon className="radar-shape" points={shape} />
      {axes.map((axis, index) => {
        const value = stats[axis.key] ?? POINT_BUY.baseValue;
        const [x, y] = point(index, Math.max(0.08, value / max));
        return <circle key={axis.key} className="radar-dot" cx={x} cy={y} r={3} />;
      })}

      {/* 축 이름 */}
      {axes.map((axis, index) => {
        const [x, y] = point(index, 1.22);
        return (
          <text
            key={axis.key}
            className="radar-label"
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {axis.label}
          </text>
        );
      })}
    </svg>
  );
}

/** 게이지 목록 — 정확한 값은 여기서 읽는다. 강화분(statBonus)은 따로 표시한다. */
export function StatBars({
  side,
  stats,
  statBonus,
}: {
  side: ActorSide;
  stats: StatBlock;
  statBonus?: StatBlock | null;
}) {
  const max = POINT_BUY.maxValue;

  return (
    <ul className="stat-bars">
      {statsFor(side).map((stat) => {
        const base = stats[stat.key] ?? POINT_BUY.baseValue;
        const gain = statBonus?.[stat.key] ?? 0;
        const value = base + gain;
        return (
          <li key={stat.key} title={`${stat.labelKo} — ${stat.effect}`}>
            <i>{stat.label}</i>
            <span className="stat-bar-ko">{stat.labelKo}</span>
            <span className="stat-bar-track">
              <span
                className="stat-bar-fill"
                style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
              />
            </span>
            <b className="num">
              {value}
              {gain > 0 && <small className="gold"> (강화 +{gain})</small>}
            </b>
          </li>
        );
      })}
    </ul>
  );
}

/** 환산 수치 타일 — 게임 상태창처럼 큰 숫자로 */
export function DerivedTiles({
  sheet,
}: {
  sheet: { side: ActorSide; classId: string; stats: StatBlock; statBonus?: StatBlock | null };
}) {
  const tiles =
    sheet.side === 'HUNTER'
      ? (() => {
          const derived = deriveHunter(sheet);
          return [
            { key: 'HP', label: '최대 HP', value: String(derived.maxHp) },
            { key: 'ATK', label: '공격', value: String(derived.attack) },
            { key: 'DEF', label: '방어', value: String(derived.defense) },
            { key: 'AP', label: '행동력', value: String(derived.maxAp) },
          ];
        })()
      : (() => {
          const derived = deriveConstellation(sheet);
          return [
            { key: 'POWER', label: '권능 배율', value: `×${derived.power}` },
            { key: 'AP', label: '행동력', value: String(derived.maxAp) },
          ];
        })();

  return (
    <ul className="derived-tiles">
      {tiles.map((tile) => (
        <li key={tile.key}>
          <i>{tile.key}</i>
          <b className="num">{tile.value}</b>
          <small>{tile.label}</small>
        </li>
      ))}
    </ul>
  );
}

/** 스탯 창 한 벌 — 도형 · 게이지 · 환산 */
export function StatPanel({
  sheet,
}: {
  sheet: { side: ActorSide; classId: string; stats: StatBlock; statBonus?: StatBlock | null };
}) {
  const gained = Object.entries(sheet.statBonus ?? {}).filter(([, amount]) => amount > 0);

  return (
    <div className="stat-panel">
      <div className="stat-panel-chart">
        <StatRadar side={sheet.side} stats={sheet.stats} />
        <span className="stat-panel-cap">
          배분 상한 {POINT_BUY.maxValue} · 자유 배분 {POINT_BUY.freePoints}점
          {gained.length > 0 && ' · 강화는 배분 밖에서 오릅니다'}
        </span>
      </div>
      <div className="stat-panel-detail">
        <StatBars side={sheet.side} stats={sheet.stats} statBonus={sheet.statBonus} />
        <DerivedTiles sheet={sheet} />
      </div>
    </div>
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
  supply,
}: {
  sheet: CharacterSheet;
  accountId?: string;
  note?: ReactNode;
  /** 소지금과 가방. 생략하면 이 시트 주인의 것을 쓴다 — 남의 지갑이 실리지 않게 한다. */
  supply?: Supply | null;
}) {
  const classDef = findClass(sheet.side, sheet.classId);
  const hunter = sheet.side === 'HUNTER';
  const skills = sheet.skills ?? [];
  const purse: Supply = supply ?? {
    points: sheet.points ?? 0,
    inventory: sheet.inventory ?? [],
  };

  return (
    <article className={`sheet-card detail ${hunter ? 'hunter' : 'constellation'}`}>
      <header className="sheet-card-head">
        <Portrait src={sheet.portrait} name={sheet.name} size="md" />
        <div className="sheet-head-text">
          <div className="sheet-head-line">
            <b>{sheet.name || '(이름 없음)'}</b>
            <span className={`tag ${hunter ? 'blue' : 'gold'}`}>{sideLabel(sheet.side)}</span>
            {hunter && (
              <span className={`tag ${sheet.affiliation === 'GOVERNMENT' ? 'blue' : 'gold'}`}>
                {affiliationLabel(sheet.affiliation)}
              </span>
            )}
          </div>
          <span className="dim small-text">
            {classDef ? `${classDef.label} · ${classDef.labelKo}` : `미지정 (${sheet.classId})`}
          </span>
          {accountId && <span className="field-label">@{accountId}</span>}
        </div>
        {note && <div className="sheet-head-note">{note}</div>}
      </header>

      <div className="sheet-block">
        <span className="field-label">스탯 · 환산</span>
        <StatPanel sheet={sheet} />
      </div>

      <div className="sheet-block">
        <span className="field-label">페어명</span>
        <span className={sheet.pairName.trim() ? '' : 'dim'}>
          {sheet.pairName.trim() || '미정 — 공란'}
        </span>
      </div>

      <div className="sheet-block">
        <span className="field-label">계약 상대</span>
        <span className={sheet.partnerName.trim() ? '' : 'dim'}>
          {sheet.partnerName.trim() || '미정 — 공란'}
        </span>
      </div>

      <div className="sheet-block">
        <span className="field-label">스킬 {skills.length}</span>
        <SkillList skills={skills} />
      </div>

      <div className="sheet-block">
        <span className="field-label">컨셉</span>
        {hasProfile(sheet) ? (
          <ProfileBlock source={sheet} compact />
        ) : (
          <p className="dim small-text">적어 둔 설정 없음</p>
        )}
      </div>

      <div className="sheet-block">
        <span className="field-label">보급 · 포인트</span>
        <SupplyBlock supply={purse} />
      </div>
    </article>
  );
}

/* ── 요약 카드 ──────────────────────────────────────────
   시트 전문(PublicSheetCard)은 서류다 — 한 사람을 처음 볼 때 읽기에는 너무 길다.
   명함처럼 한눈에 들어오는 장을 따로 둔다. 전문은 접어 두고 원할 때 펼친다. */

/** 서술 한 덩어리를 카드에 실을 만큼만 줄인다 — 줄바꿈은 한 칸으로 눕힌다 */
function blurbOf(profile: SheetProfile, limit = 96): string {
  const source = [profile.personality, profile.traits, profile.contractStory]
    .map((text) => (text ?? '').trim())
    .find((text) => text.length > 0);
  if (!source) return '';

  const flat = source.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  // 문장이 끝나는 자리에서 자르면 말이 잘린 티가 덜 난다
  const cut = flat.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('다 '), cut.lastIndexOf('다.'));
  return `${(stop > limit * 0.5 ? cut.slice(0, stop + 1) : cut).trim()}…`;
}

/**
 * 프로필 카드 — 한 사람을 카드 한 장으로 요약한다.
 *
 * 사진 · 이름 · 클래스 · 소속 · 페어 · 한 줄 소개 · 스탯 한 줄 · 기술 이름까지만 싣는다.
 * 수치 환산과 서술 전문은 담지 않는다 — 그것은 시트 전문(PublicSheetCard)의 몫이다.
 * 서식(모서리 괄호 · 도장 · 바탕)은 전문과 같은 것을 쓰되 크기만 줄인다.
 */
export function ProfileCard({
  profile,
  squad,
  partnerName,
  action,
}: {
  profile: PublicProfile;
  /** 관리국이 확정한 편성 라벨 — 있으면 태그로 붙는다 */
  squad?: string | null;
  /** 편성 쪽 상대 이름 — 참가자가 적어 둔 값보다 우선한다 */
  partnerName?: string | null;
  /** 카드 아래에 붙일 버튼 (시트 전문 보기 등) */
  action?: ReactNode;
}) {
  const hunter = profile.side === 'HUNTER';
  const classDef = findClass(profile.side, profile.classId);
  const partner = (partnerName ?? '').trim() || profile.partnerName.trim();
  const blurb = blurbOf(profile);
  const skills = profile.skills ?? [];

  return (
    <article className={`dossier card ${hunter ? 'hunter' : 'constellation'}`}>
      <span className="dossier-frame" aria-hidden="true" />

      <header className="dossier-top">
        <span className="dossier-stamp">{hunter ? 'HUNTER FILE' : 'STELLAR RECORD'}</span>
        <span className="dossier-serial">@{profile.accountId}</span>
      </header>

      <div className="dossier-id">
        <Portrait src={profile.portrait} name={profile.name} size="md" />
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
            {squad && <span className="tag ok">{squad}</span>}
          </div>
        </div>
      </div>

      {blurb ? (
        <p className="card-blurb">{blurb}</p>
      ) : (
        <p className="card-blurb dim">적어 둔 설정이 아직 없습니다.</p>
      )}

      <dl className="card-facts">
        <div>
          <dt>페어명</dt>
          <dd className={profile.pairName.trim() ? '' : 'dim'}>
            {profile.pairName.trim() || '미정'}
          </dd>
        </div>
        <div>
          <dt>계약 상대</dt>
          <dd className={partner ? '' : 'dim'}>{partner || '미정'}</dd>
        </div>
      </dl>

      <StatLine side={profile.side} stats={profile.stats} />

      {skills.length > 0 && (
        <div className="card-chips">
          {/* 이름만 늘어놓는다 — 수치는 전문에서 읽는다 */}
          {skills.slice(0, 4).map((skill) => (
            <span className="chip-tag" key={skill.id}>
              {skill.name || '(이름 없음)'}
            </span>
          ))}
          {skills.length > 4 && <span className="chip-tag dim">+{skills.length - 4}</span>}
        </div>
      )}

      {action && <footer className="card-foot">{action}</footer>}
    </article>
  );
}

/**
 * 편성 카드 — 한 장에 두 사람이 실린다.
 *
 * 누가 누구와 짝인지는 커뮤니티가 함께 읽는 정보다. 그래서 이 카드는 **누구나** 본다
 * (0020 · public_pairs). 사진과 클래스는 명부에서 이미 읽어 둔 프로필에서 가져오고,
 * 프로필을 못 찾으면 편성에 적힌 이름만으로도 카드가 선다.
 */
export function PairCard({
  pair,
  hunter,
  constellation,
  onOpen,
}: {
  pair: PublicPair;
  hunter?: PublicProfile | null;
  constellation?: PublicProfile | null;
  /** 한쪽을 누르면 그 사람의 글로 넘어간다. 활동명이 없으면 누를 수 없다. */
  onOpen?: (handle: string) => void;
}) {
  const sides: Array<{
    key: ActorSide;
    handle: string | null;
    name: string;
    profile: PublicProfile | null | undefined;
  }> = [
    { key: 'HUNTER', handle: pair.hunterHandle, name: pair.hunterName, profile: hunter },
    {
      key: 'CONSTELLATION',
      handle: pair.constellationHandle,
      name: pair.constellationName,
      profile: constellation,
    },
  ];

  return (
    <article className="pair-card">
      <header className="pair-card-top">
        <b>{pair.label}</b>
        <span className={`tag ${pair.affiliation === 'GOVERNMENT' ? 'blue' : 'gold'}`}>
          {affiliationLabel(pair.affiliation)}
        </span>
      </header>

      <div className="pair-card-body">
        {sides.map((side, index) => {
          const profile = side.profile ?? null;
          const classDef = profile ? findClass(profile.side, profile.classId) : null;
          const name = (profile?.name ?? '').trim() || side.name.trim() || '자리 비어 있음';
          const openable = !!side.handle && !!onOpen;
          const Tag = openable ? 'button' : 'div';

          return (
            <div className="pair-card-cell" key={side.key}>
              {/* 두 사람 사이의 × — 계약이 걸린 자리다 */}
              {index === 1 && <span className="pair-card-x" aria-hidden="true">×</span>}
              <Tag
                {...(openable
                  ? { type: 'button' as const, onClick: () => onOpen!(side.handle as string) }
                  : {})}
                className={`pair-side ${side.key === 'HUNTER' ? 'hunter' : 'constellation'} ${
                  openable ? 'open' : ''
                }`}
              >
                <Portrait src={profile?.portrait} name={name} size="sm" />
                <span className="pair-side-text">
                  <b>{name}</b>
                  <small>
                    {sideLabel(side.key)}
                    {classDef ? ` · ${classDef.labelKo}` : ''}
                  </small>
                  {side.handle && <small className="dim">@{side.handle}</small>}
                </span>
              </Tag>
            </div>
          );
        })}
      </div>
    </article>
  );
}

/**
 * 프로필 한 장 — 참가자가 제출한 시트 내용을 전부 싣는다.
 *
 * 성격 · 특징 · 계약 경위 · 스킬 · 스탯 · 환산 수치까지 가리는 것 없이 보여 준다.
 * 비워 둔 칸도 자리를 남긴다 — 무엇을 안 적었는지도 정보다.
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
  supply,
}: {
  profile: PublicProfile;
  badge?: ReactNode;
  /** 편성이 확정된 경우의 상대 이름 — 참가자가 적어 둔 값보다 우선한다 */
  partnerName?: string | null;
  /**
   * 소지금과 가방. 생략하면 **이 카드 주인의 것**을 쓴다.
   *
   * 카드는 한 사람의 서류다 — 남의 지갑이 실리면 공용처럼 보인다.
   * 그래서 기본값을 주인 것으로 두고, 넘겨받은 값은 덮어쓰기로만 쓴다.
   */
  supply?: Supply | null;
}) {
  const hunter = profile.side === 'HUNTER';
  const classDef = findClass(profile.side, profile.classId);
  const partner = (partnerName ?? '').trim() || profile.partnerName.trim();
  const purse: Supply = supply ?? {
    points: profile.points ?? 0,
    inventory: profile.inventory ?? [],
  };

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
          <dt>페어명</dt>
          <dd className={profile.pairName.trim() ? '' : 'dim'}>
            {profile.pairName.trim() || '미정'}
          </dd>
        </div>
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
        {/* 제출한 시트 내용은 빠짐없이 싣는다 — 비워 둔 칸도 자리를 남겨 무엇을 안 적었는지 보이게 한다 */}
        {PROFILE_FIELDS.map((field, index) => {
          const value = (profile[field.key] ?? '').trim();
          return (
            <section key={field.key} className="dossier-part">
              <h4 className="dossier-part-title">
                <span className="dossier-index">{String(index + 1).padStart(2, '0')}</span>
                <span>{field.labelKo}</span>
                <i>{field.label}</i>
              </h4>
              {value ? (
                <p className="concept-text">{value}</p>
              ) : (
                <p className="concept-text dim">미기입</p>
              )}
            </section>
          );
        })}

        <section className="dossier-part">
          <h4 className="dossier-part-title">
            <span className="dossier-index">{String(PROFILE_FIELDS.length + 1).padStart(2, '0')}</span>
            <span>보유 기술</span>
            <i>SKILL</i>
          </h4>
          <SkillList skills={profile.skills} />
        </section>

        <section className="dossier-part">
          <h4 className="dossier-part-title">
            <span className="dossier-index">{String(PROFILE_FIELDS.length + 2).padStart(2, '0')}</span>
            <span>스탯 · 환산</span>
            <i>STATS</i>
          </h4>
          <StatPanel sheet={profile} />
        </section>

        <section className="dossier-part">
          <h4 className="dossier-part-title">
            <span className="dossier-index">
              {String(PROFILE_FIELDS.length + 3).padStart(2, '0')}
            </span>
            <span>보급 · 포인트</span>
            <i>SUPPLY</i>
          </h4>
          <SupplyBlock supply={purse} />
        </section>
      </div>

      <footer className="dossier-foot">
        <span>{hunter ? 'HUNTER MANAGEMENT AGENCY' : 'ASTRAL REGISTRY'}</span>
        <span>등록 시트 전문 — 참가자 열람용</span>
      </footer>
    </article>
  );
}
