/**
 * 전투 로그 생성.
 *
 * Phase 1 에서는 SYSTEM 채널만 사용한다.
 * ROLEPLAY(연출) 로그는 같은 LogEntry 구조를 그대로 쓰며 Phase 5 에서 추가한다.
 */

import type { LogChannel, LogEntry } from '../types';

let sequence = 0;

export function formatClock(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export interface LogInput {
  round: number;
  text: string;
  detail?: string;
  channel?: LogChannel;
  /** 관련 페어. 전투 전체에 대한 로그면 비워 둔다. */
  pairId?: string | null;
}

export function createLogEntry(input: LogInput, now: Date = new Date()): LogEntry {
  sequence += 1;
  return {
    id: `${now.getTime()}-${sequence}`,
    at: formatClock(now),
    channel: input.channel ?? 'SYSTEM',
    round: input.round,
    pairId: input.pairId ?? null,
    text: input.text,
    detail: input.detail,
  };
}

/** 로그가 무한히 쌓이지 않도록 최근 항목만 유지한다. */
export function appendLog(log: LogEntry[], entries: LogEntry[], limit = 400): LogEntry[] {
  const next = [...log, ...entries];
  return next.length > limit ? next.slice(next.length - limit) : next;
}
