/**
 * 캐릭터 시트 → 전투 상태 파생.
 *
 * 공식 계수는 config/characters.ts 에 있고, 여기서는 조합만 한다.
 * 전투가 시작되면 시트에서 파생된 값이 전투 상태로 복사된다 —
 * 전투 중 운영진이 수치를 바꿔도 시트 원본은 그대로 남는다.
 */

import {
  POINT_BUY,
  PROFILE_FIELDS,
  STAT_SCALING,
  findClass,
  remainingPoints,
  statsFor,
  toProfile,
} from '../config/characters';
import { AP_RULES, HUNTER_DEFAULTS, MANIFEST_RULES } from '../config/rules';
import type {
  ActorSide,
  CharacterSheet,
  ConstellationState,
  HunterState,
  SheetProfile,
  SkillDefinition,
  StatBlock,
} from '../types';
import { toRuntime, validateSkills } from './skills';

export interface DerivedHunter {
  maxHp: number;
  attack: number;
  defense: number;
  maxAp: number;
}

export interface DerivedConstellation {
  maxAp: number;
  /** 권능 효과 배율 */
  power: number;
}

function statValue(stats: StatBlock, key: string): number {
  return stats[key] ?? POINT_BUY.baseValue;
}

/**
 * 클래스와 스탯만 있으면 환산할 수 있다 — 시트 전문이 아니어도 받는다.
 * statBonus 는 강화 아이템으로 영구히 올린 값이며, 배분 점수와 따로 더한다.
 */
type DerivableSheet = { classId: string; stats: StatBlock; statBonus?: StatBlock | null };

/** 배분한 스탯 + 강화로 올린 스탯. 전투에 들어가는 값은 언제나 이것이다. */
export function effectiveStats(sheet: {
  stats: StatBlock;
  statBonus?: StatBlock | null;
}): StatBlock {
  const bonus = sheet.statBonus;
  if (!bonus) return { ...sheet.stats };

  const merged: StatBlock = { ...sheet.stats };
  for (const [key, amount] of Object.entries(bonus)) {
    if (!amount) continue;
    merged[key] = (merged[key] ?? POINT_BUY.baseValue) + amount;
  }
  return merged;
}

export function deriveHunter(sheet: DerivableSheet): DerivedHunter {
  const scaling = STAT_SCALING.hunter;
  const bonus = findClass('HUNTER', sheet.classId)?.bonus ?? {};
  const stats = effectiveStats(sheet);

  const maxHp = Math.max(
    1,
    Math.round(
      HUNTER_DEFAULTS.baseHp + statValue(stats, 'vit') * scaling.hpPerVit + (bonus.maxHp ?? 0),
    ),
  );
  const attack = Math.max(
    1,
    Math.round(
      HUNTER_DEFAULTS.baseAttack +
        statValue(stats, 'str') * scaling.attackPerStr +
        (bonus.attack ?? 0),
    ),
  );
  const defense = Math.max(
    0,
    Math.round(
      HUNTER_DEFAULTS.baseDefense +
        statValue(stats, 'agi') * scaling.defensePerAgi +
        (bonus.defense ?? 0),
    ),
  );
  const maxAp = Math.max(1, AP_RULES.hunterMaxAp + (bonus.maxAp ?? 0));

  return { maxHp, attack, defense, maxAp };
}

export function deriveConstellation(sheet: DerivableSheet): DerivedConstellation {
  const scaling = STAT_SCALING.constellation;
  const bonus = findClass('CONSTELLATION', sheet.classId)?.bonus ?? {};
  const stats = effectiveStats(sheet);

  const power =
    1 + statValue(stats, 'authority') * scaling.powerPerAuthority + (bonus.power ?? 0);
  const maxAp = Math.max(
    1,
    AP_RULES.constellationMaxAp +
      Math.floor(statValue(stats, 'divinity') / scaling.apPerDivinity) +
      (bonus.maxAp ?? 0),
  );

  return { power: Math.round(power * 100) / 100, maxAp };
}

export function hunterStateFromSheet(sheet: CharacterSheet): HunterState {
  const derived = deriveHunter(sheet);
  return {
    name: sheet.name,
    hp: derived.maxHp,
    maxHp: derived.maxHp,
    ap: derived.maxAp,
    maxAp: derived.maxAp,
    attack: derived.attack,
    defense: derived.defense,
    control: 'ACTIVE',
    sheetId: sheet.id,
    classId: sheet.classId,
    statuses: [],
    skills: toRuntime(sheet.skills ?? []),
    stats: effectiveStats(sheet),
    lastStandUsed: false,
    // 소지금과 가방은 개인 소유다 — 시트에 있는 것을 그대로 들고 들어간다
    points: sheet.points ?? 0,
    inventory: (sheet.inventory ?? []).map((row) => ({ ...row })),
  };
}

export function constellationStateFromSheet(sheet: CharacterSheet): ConstellationState {
  const derived = deriveConstellation(sheet);
  return {
    name: sheet.name,
    ap: derived.maxAp,
    maxAp: derived.maxAp,
    stage: 'STABLE',
    control: 'ACTIVE',
    power: derived.power,
    sheetId: sheet.id,
    classId: sheet.classId,
    statuses: [],
    skills: toRuntime(sheet.skills ?? []),
    stats: effectiveStats(sheet),
    points: sheet.points ?? 0,
    inventory: (sheet.inventory ?? []).map((row) => ({ ...row })),
    manifestUses: {
      partial: MANIFEST_RULES.partialPerBattle,
      full: MANIFEST_RULES.fullPerCampaign,
    },
  };
}

/* ── 검증 ──────────────────────────────────────────────── */

export interface SheetIssue {
  field: 'name' | 'classId' | 'stats' | 'profile' | 'skills';
  message: string;
}

export function validateSheet(sheet: {
  side: ActorSide;
  name: string;
  classId: string;
  stats: StatBlock;
  /** 강화로 오른 값 — 배분 규칙 밖이라 검증하지 않는다 */
  statBonus?: StatBlock | null;
  skills?: SkillDefinition[];
} & Partial<SheetProfile>): SheetIssue[] {
  const issues: SheetIssue[] = [];
  const name = sheet.name.trim();

  if (name.length < 1) {
    issues.push({ field: 'name', message: '이름을 입력하세요.' });
  } else if (name.length > 24) {
    issues.push({ field: 'name', message: '이름은 24자 이내로 입력하세요.' });
  }

  if (!findClass(sheet.side, sheet.classId)) {
    issues.push({
      field: 'classId',
      message: sheet.side === 'HUNTER' ? '클래스를 선택하세요.' : '권역을 선택하세요.',
    });
  }

  const remaining = remainingPoints(sheet.side, sheet.stats);
  if (remaining > 0) {
    issues.push({ field: 'stats', message: `배분하지 않은 스탯 ${remaining}점이 남았습니다.` });
  } else if (remaining < 0) {
    issues.push({ field: 'stats', message: `스탯을 ${-remaining}점 초과 배분했습니다.` });
  }

  for (const stat of statsFor(sheet.side)) {
    // 검증은 배분한 스탯만 본다 — 강화(statBonus)는 배분 규칙 밖에서 오른다
    const value = statValue(sheet.stats, stat.key);
    if (value < POINT_BUY.baseValue || value > POINT_BUY.maxValue) {
      issues.push({
        field: 'stats',
        message: `${stat.labelKo}은 ${POINT_BUY.baseValue}~${POINT_BUY.maxValue} 범위여야 합니다.`,
      });
      break;
    }
  }

  const profile = toProfile(sheet);
  for (const field of PROFILE_FIELDS) {
    if (profile[field.key].trim().length > field.maxChars) {
      issues.push({
        field: 'profile',
        message: `${field.labelKo}은(는) ${field.maxChars}자 이내로 입력하세요.`,
      });
    }
  }

  for (const issue of validateSkills(sheet.skills ?? [], sheet.side)) {
    issues.push({ field: 'skills', message: issue.message });
  }

  return issues;
}
