/**
 * 라운드 한 판의 기록장.
 *
 * 적용 단계는 아홉 걸음을 순서대로 밟으면서, 걸음마다 **무슨 일이 있었는지**를 적고
 * 급한 것은 경보로 띄운다. 그 두 가지는 계산과 다른 종류의 일이라 여기로 걷어 냈다.
 *
 * 적용 함수 안에서 클로저로 만들어 쓰던 것이라, 어느 걸음이 무엇을 적는지가
 * 590줄 안에 섞여 있었다. 기록장을 밖으로 내면 걸음마다 무엇을 남기는지가 인자로 드러난다.
 *
 * 경보 id 는 시각 + 일련번호다 — 같은 밀리초에 여러 개가 떠도 겹치지 않아야 한다.
 */

import { createLogEntry } from '../log';
import type { AlertLevel, BattleAlert, LogEntry } from '../../types';

export interface RoundJournal {
  /** 시스템 로그 한 줄 */
  log: (text: string, detail?: string, pairId?: string | null) => void;
  /** 경보 — 로그에도 같은 내용이 함께 남는다 */
  alert: (level: AlertLevel, title: string, message: string) => void;
  /** 연출 로그처럼 이미 만들어진 줄을 그대로 넣는다 */
  push: (entry: LogEntry) => void;
  /** 이번 라운드에 쌓인 것들 — 배열 그대로 돌려주므로 마지막에 붙이면 된다 */
  readonly entries: LogEntry[];
  readonly alerts: BattleAlert[];
}

export function createJournal(round: number, now: Date): RoundJournal {
  const entries: LogEntry[] = [];
  const alerts: BattleAlert[] = [];
  let alertSeq = 0;

  const log: RoundJournal['log'] = (text, detail, pairId = null) => {
    entries.push(createLogEntry({ round, text, detail, pairId }, now));
  };

  const alert: RoundJournal['alert'] = (level, title, message) => {
    alertSeq += 1;
    alerts.push({ id: `${now.getTime()}-${alertSeq}`, level, title, message, round });
    log(`${level} — ${title}`, message);
  };

  return { log, alert, push: (entry) => entries.push(entry), entries, alerts };
}
