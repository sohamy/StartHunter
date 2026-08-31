/**
 * 클래스 · 권역 특성과 스탯이 라운드 처리에 개입하는 지점.
 *
 * 조건은 config/characters.ts 의 데이터이고, 이 파일은 그 데이터를 해석할 뿐이다.
 * 여기에 클래스 id 를 적지 않는다 — 새 클래스를 추가할 때 엔진을 고치지 않기 위한 것이다.
 */

import {
  POINT_BUY,
  STAT_SCALING,
  findClass,
  type ClassTraits,
} from '../config/characters';
import { LAST_STAND_RULES } from '../config/rules';
import type { ConstellationState, HunterState, StatBlock } from '../types';

const EMPTY: ClassTraits = {};

export function statValue(stats: StatBlock, key: string): number {
  return stats[key] ?? POINT_BUY.baseValue;
}

export function hunterTraits(hunter: HunterState): ClassTraits {
  return findClass('HUNTER', hunter.classId)?.traits ?? EMPTY;
}

export function constellationTraits(constellation: ConstellationState): ClassTraits {
  return findClass('CONSTELLATION', constellation.classId)?.traits ?? EMPTY;
}

/* ── 헌터 ──────────────────────────────────────────────── */

/**
 * 받는 디버프의 지속시간 단축 (의지).
 * 판정을 굴리지 않는다 — 예상 결과와 실제 결과가 어긋나면 안 되기 때문이다.
 */
export function statusResistRounds(hunter: HunterState): number {
  const wil = statValue(hunter.stats, 'wil');
  return Math.floor(wil / STAT_SCALING.hunter.resistPerWil);
}

/** 전투 불능 저항을 지금 쓸 수 있는지 (의지) */
export function canLastStand(hunter: HunterState): boolean {
  if (LAST_STAND_RULES.usesPerBattle <= 0) return false;
  if (hunter.lastStandUsed) return false;
  return statValue(hunter.stats, 'wil') >= STAT_SCALING.hunter.lastStandMinWil;
}

/** 약점이 드러난 적을 노릴 때 붙는 피해 (원거리 사격형) */
export function weakPointBonus(hunter: HunterState, enemyHasWeakness: boolean): number {
  if (!enemyHasWeakness) return 0;
  return hunterTraits(hunter).weakPointBonus ?? 0;
}

/** 성좌에게 받는 공격력 버프 증폭 배율 (권능 술사형) */
export function buffAmplifier(hunter: HunterState): number {
  return 1 + (hunterTraits(hunter).buffAmplify ?? 0);
}

/** 구조 회복량에 붙는 비율 — 헌터 클래스와 성좌 권역이 함께 더한다 */
export function rescueBonus(hunter: HunterState, constellation: ConstellationState): number {
  return (hunterTraits(hunter).rescueBonus ?? 0) + (constellationTraits(constellation).rescueBonus ?? 0);
}

/** 회복량에 붙는 비율 — 헌터 클래스와 성좌 권역이 함께 더한다 */
export function healBonus(hunter: HunterState, constellation: ConstellationState): number {
  return (hunterTraits(hunter).healBonus ?? 0) + (constellationTraits(constellation).healBonus ?? 0);
}

/**
 * 피해 감소 상태이상을 걸 때 붙는 효과 배율.
 * 보호 행동은 protectBonus, 그 밖의 피해 감소 부여는 guardAmplify 를 쓴다.
 */
export function protectAmplifier(
  hunter: HunterState,
  constellation: ConstellationState,
  viaProtectAction: boolean,
): number {
  const h = hunterTraits(hunter);
  const c = constellationTraits(constellation);
  const guard = (h.guardAmplify ?? 0) + (c.guardAmplify ?? 0);
  const protect = viaProtectAction ? (h.protectBonus ?? 0) + (c.protectBonus ?? 0) : 0;
  return 1 + guard + protect;
}

/* ── 성좌 ──────────────────────────────────────────────── */

/** 계시가 공략조 전체에 공유되는지 (예지 권역) */
export function revelationShared(constellation: ConstellationState): boolean {
  return constellationTraits(constellation).revelationShared === true;
}

/** 이 성좌가 적에게 거는 상태이상의 지속 라운드 추가분 (재앙 권역) */
export function statusDurationBonus(constellation: ConstellationState): number {
  return constellationTraits(constellation).statusDurationBonus ?? 0;
}

/** 현신 위력 배율 (현신 스탯) */
export function manifestPower(constellation: ConstellationState): number {
  const man = statValue(constellation.stats, 'manifest');
  return 1 + man * STAT_SCALING.constellation.manifestPowerPerPoint;
}

/**
 * 현신 반동 경감 비율 (현신 스탯).
 * 1 을 넘지 않게 잘라서 반동이 회복으로 뒤집히지 않게 한다.
 */
export function recoilRelief(constellation: ConstellationState): number {
  const man = statValue(constellation.stats, 'manifest');
  return Math.min(0.8, man * STAT_SCALING.constellation.recoilReliefPerPoint);
}

/** 라운드마다 회복되는 계약 안정도 (공명 스탯) */
export function contractRecovery(constellation: ConstellationState): number {
  const res = statValue(constellation.stats, 'resonance');
  return res * STAT_SCALING.constellation.contractRecoveryPerResonance;
}
