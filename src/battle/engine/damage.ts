/**
 * 피해 계산.
 *
 * UI 나 저장 계층을 참조하지 않는 순수 함수로 유지한다.
 * 계산 근거(notes)를 함께 돌려주어 운영진 화면과 로그에서 그대로 쓸 수 있게 한다.
 */

import { DAMAGE_RULES } from '../config/rules';
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
  /** 성좌 버프로 인한 공격력 증가 비율 */
  attackUp?: number;
  /** 성좌 디버프로 인한 적 방어력 감소 비율 */
  enemyDefenseDown?: number;
}

export function hunterAttackDamage(input: HunterAttackInput): DamageResult {
  const { hunter, enemy, powerRatio } = input;
  const attackUp = input.attackUp ?? 0;
  const defenseDown = input.enemyDefenseDown ?? 0;

  const notes: string[] = [];

  const base = hunter.attack * powerRatio;
  notes.push(`기본 공격력 ${hunter.attack} × 계수 ${powerRatio} = ${round1(base)}`);

  const boosted = base * (1 + attackUp);
  if (attackUp > 0) {
    notes.push(`버프 +${toPercent(attackUp)} → ${round1(boosted)}`);
  }

  const effectiveDefense = enemy.defense * (1 - defenseDown);
  if (defenseDown > 0) {
    notes.push(
      `적 방어력 ${enemy.defense} − ${toPercent(defenseDown)} → ${round1(effectiveDefense)}`,
    );
  } else {
    notes.push(`적 방어력 ${enemy.defense}`);
  }

  const amount = Math.max(DAMAGE_RULES.minimumDamage, Math.floor(boosted - effectiveDefense));
  notes.push(`최종 피해 ${amount}`);

  return { amount, notes };
}

export interface EnemyAttackInput {
  enemy: EnemyState;
  /** 피격 대상 헌터 — 방어력이 피해를 상수로 깎는다 */
  hunter: HunterState;
  /** 헌터가 방어 행동으로 확보한 피해 감소 비율 */
  damageReduction?: number;
}

export function enemyAttackDamage(input: EnemyAttackInput): DamageResult {
  const reduction = input.damageReduction ?? 0;
  const notes: string[] = [];

  notes.push(`적 공격력 ${input.enemy.attack}`);

  const afterDefense = input.enemy.attack - input.hunter.defense;
  if (input.hunter.defense > 0) {
    notes.push(`헌터 방어력 ${input.hunter.defense} → ${round1(afterDefense)}`);
  }

  const raw = afterDefense * (1 - reduction);
  if (reduction > 0) {
    notes.push(`방어 행동으로 ${toPercent(reduction)} 감소 → ${round1(raw)}`);
  }

  const amount = Math.max(DAMAGE_RULES.minimumDamage, Math.floor(raw));
  notes.push(`최종 피해 ${amount}`);

  return { amount, notes };
}

function toPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
