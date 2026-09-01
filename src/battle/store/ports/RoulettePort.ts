/**
 * 운명 도박장 — 한 도메인의 전부.
 *
 * 상점과 같은 이유로 두 저장소에 걸쳐 있다.
 *
 *   · 원반(RouletteCatalog) — 어떤 원반이 열려 있고 무슨 칸이 있는가. 세계 데이터다.
 *     전광판(회전 기록)도 여기 있다 — 남에게 보이는 게시물이지 지갑이 아니다.
 *   · 창구(RouletteCounter) — 돌리는 일. **어느 칸에 걸리는지는 서버가 뽑는다**
 *     (roulette_spin). 참가자 화면의 회전은 이미 정해진 결과를 뒤늦게 따라 도는 연출이다.
 *
 * 화면은 도박장 하나만 본다 — `getRoulette()` 이 둘을 묶는다.
 */

import type { RouletteSpin, RouletteWheel } from '../../types';

/** 한 번 돌린 결과 */
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

/** 원반과 전광판 — 운영진이 정하고, 누구나 읽는다 */
export interface RouletteCatalog {
  listWheels(): Promise<RouletteWheel[]>;
  saveWheel(wheel: RouletteWheel): Promise<void>;
  deleteWheel(id: string): Promise<void>;
  /**
   * 최근 회전 기록 — 전광판과 운영진 확인에 쓴다.
   * 소지금은 담기지 않는다 (전광판은 남의 지갑을 보여 주는 곳이 아니다).
   */
  recentSpins(limit?: number): Promise<RouletteSpin[]>;
  /** 한 줄 지우기 — 운영진만 된다 (0019 · spins operator delete) */
  deleteSpin(id: string): Promise<void>;
  /**
   * 전부 비우기 — 운영진만 된다.
   * 소지금은 건드리지 않는다. 기록은 정산 근거가 아니라 게시물이므로 지워도 지갑은 그대로다.
   */
  clearSpins(): Promise<void>;
}

/** 창구 — 결과를 뽑는 쪽 */
export interface RouletteCounter {
  spin(wheelId: string): Promise<SpinOutcome>;
}

/** 화면이 보는 것 */
export type RoulettePort = RouletteCatalog & RouletteCounter;
