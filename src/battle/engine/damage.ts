/**
 * 피해 계산.
 *
 * UI 나 저장 계층을 참조하지 않는 순수 함수로 유지한다.
 * 계산 근거(notes)를 함께 돌려주어 운영진 화면과 로그에서 그대로 쓸 수 있게 한다.
 *
 * 상태이상은 이미 합산된 보정치(StatusModifiers)로 받는다 —
 * 이 파일은 개별 상태이상 이름을 알지 않는다.
 */

import { DAMAGE_RULES } from '../config/rules';
import type { StatusModifiers } from '../config/status';
import type { EnemyState, HunterState } from '../types';

export interface DamageResult {
  amount: number;
  notes: string[];
}

export interface HunterAttackInput {
  hunter: HunterState;
  enemy: EnemyState;
  /** 행동의 피해 계수 */
  powerRatio: number;
  /** 헌터에게 걸린 상태이상 합산치 */
  hunterModifiers?: StatusModifiers;
  /** 적에게 걸린 상태이상 합산치 */
  enemyModifiers?: StatusModifiers;
}

export function hunterAttackDamage(input: HunterAttackInput): DamageResult {
  const { hunter, enemy, powerRatio } = input;
  const hunterMods = input.hunterModifiers ?? {};
  const enemyMods = input.enemyModifiers ?? {};

  const notes: string[] = [];

  const base = hunter.attack * powerRatio;
  notes.push(`기본 공격력 ${hunter.attack} × 계수 ${round1(powerRatio)} = ${round1(base)}`);

  const attackShift = (hunterMods.attackUp ?? 0) - (hunterMods.attackDown ?? 0);
  const boosted = base * (1 + attackShift);
  if (attackShift !== 0) {
    notes.push(`공격력 보정 ${signedPercent(attackShift)} → ${round1(boosted)}`);
  }

  const defenseDown = Math.min(0.95, enemyMods.defenseDown ?? 0);
  const effectiveDefense = enemy.defense * (1 - defenseDown);
  if (defenseDown > 0) {
    notes.push(
      `적 방어력 ${enemy.defense} − ${toPercent(defenseDown)} → ${round1(effectiveDefense)}`,
    );
  } else {
    notes.push(`적 방어력 ${enemy.defense}`);
  }

  let raw = boosted - effectiveDefense;
  const taken = enemyMods.damageTaken ?? 0;
  if (taken > 0) {
    raw *= 1 + taken;
    notes.push(`약점 · 피해 증가 +${toPercent(taken)} → ${round1(raw)}`);
  }

  const amount = Math.max(DAMAGE_RULES.minimumDamage, Math.floor(raw));
  notes.push(`최종 피해 ${amount}`);

  return { amount, notes };
}

export interface EnemyAttackInput {
  enemy: EnemyState;
  /** 피격 대상 헌터 — 방어력이 피해를 상수로 깎는다 */
  hunter: HunterState;
  /** 헌터가 방어 행동으로 확보한 피해 감소 비율 */
  damageReduction?: number;
  hunterModifiers?: StatusModifiers;
  enemyModifiers?: StatusModifiers;
}

export function enemyAttackDamage(input: EnemyAttackInput): DamageResult {
  const hunterMods = input.hunterModifiers ?? {};
  const enemyMods = input.enemyModifiers ?? {};
  const notes: string[] = [];

  const attackShift = (enemyMods.attackUp ?? 0) - (enemyMods.attackDown ?? 0);
  const attack = input.enemy.attack * (1 + attackShift);
  notes.push(`적 공격력 ${input.enemy.attack}`);
  if (attackShift !== 0) {
    notes.push(`적 공격력 보정 ${signedPercent(attackShift)} → ${round1(attack)}`);
  }

  const afterDefense = attack - input.hunter.defense;
  if (input.hunter.defense > 0) {
    notes.push(`헌터 방어력 ${input.hunter.defense} → ${round1(afterDefense)}`);
  }

  // 방어 행동으로 확보한 감소와 상태이상 감소를 합산하되 상한을 둔다.
  const reduction = Math.min(
    DAMAGE_RULES.maxDamageReduction,
    (input.damageReduction ?? 0) + (hunterMods.damageReduction ?? 0),
  );
  let raw = afterDefense * (1 - reduction);
  if (reduction > 0) {
    notes.push(`피해 감소 ${toPercent(reduction)} → ${round1(raw)}`);
  }

  const taken = hunterMods.damageTaken ?? 0;
  if (taken > 0) {
    raw *= 1 + taken;
    notes.push(`받는 피해 증가 +${toPercent(taken)} → ${round1(raw)}`);
  }

  const amount = Math.max(DAMAGE_RULES.minimumDamage, Math.floor(raw));
  notes.push(`최종 피해 ${amount}`);

  return { amount, notes };
}

function toPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function signedPercent(ratio: number): string {
  const value = Math.round(ratio * 100);
  return value > 0 ? `+${value}%` : `${value}%`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
