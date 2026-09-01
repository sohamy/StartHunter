/**
 * 라운드 처리 안에서 여러 단계가 함께 쓰는 소도구.
 *
 * 여기 있는 것은 어느 단계에도 속하지 않는 것들뿐이다 —
 * 한 단계에서만 쓰는 것은 그 단계 파일에 둔다.
 */

import { type StatusModifiers } from '../../config/status';


/* ── 보정치 합산 ───────────────────────────────────────── */

export function mergeModifiers(...blocks: StatusModifiers[]): StatusModifiers {
  const total: StatusModifiers = {};
  for (const block of blocks) {
    for (const [key, value] of Object.entries(block)) {
      if (typeof value === 'number') {
        total[key as 'attackUp'] = ((total[key as 'attackUp'] ?? 0) as number) + value;
      } else if (value === true) {
        total[key as 'blockAction'] = true;
      }
    }
  }
  return total;
}


/** 소수 둘째 자리까지 — 배율 계산이 길어지면 화면에 지저분한 꼬리가 남는다 */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
