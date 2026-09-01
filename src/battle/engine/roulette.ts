/**
 * 룰렛 처리.
 *
 * 실제 뽑기는 **서버(`roulette_spin`)가** 한다. 브라우저가 칸을 골라 보내면
 * 원하는 칸을 적어 보낼 수 있기 때문이다.
 *
 * 여기 있는 것은 세 가지다.
 *   · 확률을 보여 주기 위한 계산 (무게 → %)
 *   · 운영진이 원반을 짤 때 손익을 미리 보여 주기 위한 기대값
 *   · 로컬 모드(서버 없이 혼자 확인해 볼 때)의 뽑기
 *
 * 상점(engine/shop.ts)과 같은 자리에 둔다 — 소지금을 만지는 규칙은 한곳에 모은다.
 */

import type { RouletteSlot, RouletteWheel } from '../types';

/** 무게가 0 이하인 칸은 걸리지 않는다 — 원반에 남아 있어도 뽑기에서는 빠진다 */
export function weightOf(slot: RouletteSlot): number {
  return Math.max(0, slot.weight ?? 0);
}

export function totalWeight(slots: RouletteSlot[]): number {
  return slots.reduce((sum, slot) => sum + weightOf(slot), 0);
}

/** 이 칸에 걸릴 확률 (0~1). 무게가 하나도 없으면 0 */
export function chanceOf(slots: RouletteSlot[], index: number): number {
  const total = totalWeight(slots);
  if (total <= 0) return 0;
  return weightOf(slots[index] ?? { label: '', payout: 0, weight: 0 }) / total;
}

/** 화면에 적는 확률 문자열 — 소수 한 자리까지 */
export function chanceText(slots: RouletteSlot[], index: number): string {
  return `${(chanceOf(slots, index) * 100).toFixed(1)}%`;
}

/**
 * 한 번 돌릴 때 돌려받는 기대값 (참가비를 빼기 전).
 * 운영진이 원반을 짤 때 이 값과 참가비를 견줘 본다.
 */
export function expectedPayout(slots: RouletteSlot[]): number {
  const total = totalWeight(slots);
  if (total <= 0) return 0;
  return slots.reduce((sum, slot) => sum + weightOf(slot) * Math.max(0, slot.payout ?? 0), 0) / total;
}

/**
 * 참가자 쪽 기대 손익. 음수면 돌릴수록 잃고, 양수면 돌릴수록 딴다.
 *
 * **양수인 원반은 무한정 돌리면 소지금이 계속 불어난다** —
 * 운영진 화면에서 경고를 띄우는 판단에 쓴다.
 */
export function expectedNet(wheel: Pick<RouletteWheel, 'entryFee' | 'slots'>): number {
  return expectedPayout(wheel.slots) - Math.max(0, wheel.entryFee ?? 0);
}

/** 걸릴 수 있는 가장 큰 값 */
export function topPayout(slots: RouletteSlot[]): number {
  return slots.reduce((best, slot) => Math.max(best, Math.max(0, slot.payout ?? 0)), 0);
}

/**
 * 원반이 돌아갈 수 있는 상태인지. 돌아가지 않으면 이유를 준다.
 * 서버도 같은 것을 보지만, 운영진이 저장하기 전에 알아채도록 화면에서도 본다.
 */
export function wheelProblem(wheel: Pick<RouletteWheel, 'name' | 'slots'>): string | null {
  if (!wheel.name.trim()) return '원반 이름을 적으세요.';
  if (wheel.slots.length === 0) return '칸이 하나도 없습니다.';
  if (wheel.slots.some((slot) => !slot.label.trim())) return '이름이 빈 칸이 있습니다.';
  if (totalWeight(wheel.slots) <= 0) return '무게가 모두 0 입니다 — 어느 칸도 걸리지 않습니다.';
  return null;
}

/**
 * 무게에 따라 칸 하나를 고른다.
 *
 * `roll` 은 0 이상 1 미만. 서버(plpgsql)와 같은 방식이다 —
 * 누적 무게가 굴린 값을 넘어서는 첫 칸이 당첨이다.
 */
export function pickSlot(slots: RouletteSlot[], roll: number): number {
  const total = totalWeight(slots);
  if (total <= 0) return -1;

  const target = Math.min(Math.max(roll, 0), 0.999999) * total;
  let accumulated = 0;
  for (let index = 0; index < slots.length; index += 1) {
    accumulated += weightOf(slots[index]);
    if (target < accumulated) return index;
  }
  // 끝자리 오차로 아무 칸도 못 고르는 경우 — 마지막 칸으로 떨어뜨린다
  return slots.length - 1;
}

/** 한 번 돌린 결과 — 서버 함수가 돌려주는 것과 같은 모양이다 */
export interface SpinOutcome {
  slotIndex: number;
  label: string;
  payout: number;
  fee: number;
  /** 참가비를 뺀 손익 */
  net: number;
  /** 돌리고 난 뒤의 소지금 */
  points: number;
}

export interface SpinResult {
  ok: boolean;
  reason?: string;
  outcome?: SpinOutcome;
}

/**
 * 로컬 모드의 뽑기 — 서버가 없을 때만 쓴다.
 * 서버 모드에서는 이 길로 오지 않는다 (SupabaseAuthAdapter 가 함수를 부른다).
 */
export function spin(
  wheel: RouletteWheel,
  points: number,
  rng: () => number = Math.random,
): SpinResult {
  if (!wheel.active) return { ok: false, reason: '지금 돌릴 수 없는 원반입니다.' };

  const problem = wheelProblem(wheel);
  if (problem) return { ok: false, reason: problem };

  const fee = Math.max(0, wheel.entryFee ?? 0);
  if (points < fee) {
    return { ok: false, reason: `참가비가 모자랍니다. (참가비 ${fee}P · 보유 ${points}P)` };
  }

  const index = pickSlot(wheel.slots, rng());
  const slot = wheel.slots[index];
  const payout = Math.max(0, slot.payout ?? 0);

  return {
    ok: true,
    outcome: {
      slotIndex: index,
      label: slot.label,
      payout,
      fee,
      net: payout - fee,
      points: points - fee + payout,
    },
  };
}
