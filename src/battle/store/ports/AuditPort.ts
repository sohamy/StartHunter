/**
 * 운영 감사 기록 — 누가 언제 무엇을 어떻게 고쳤는가.
 *
 * 운영진은 참가자의 소지금 · 가방 · 시트를 직접 고칠 수 있다. 그래야 운영이 되는데,
 * **그 사실이 어디에도 남지 않았다.** 「내 포인트가 왜 줄었냐」는 말이 나오면 근거가 없다.
 * 전투 보상 원장(BattleState.rewards)은 전투에서 지급한 것만 담는다.
 *
 * 그래서 사람에게 붙는 값을 고친 일은 여기 한 줄씩 남긴다.
 *
 * **덧붙이기만 한다.** 고치거나 지우는 길을 두지 않았다 — 나중에 손댈 수 있는 기록은
 * 분쟁에서 근거가 되지 못한다. 서버 쪽은 update · delete 정책을 아예 만들지 않아
 * 운영진 자신도 지울 수 없다.
 *
 * **여기 없는 것** — 전투 중 HP · 행동력 · 상태이상 수정은 담기지 않는다.
 * 그쪽은 engine/admin.ts 의 함수 30여 개가 화면에서 직접 불리는 구조라, 기록을 붙이려면
 * 호출부마다 이전 값을 들고 다녀야 한다. 전투는 끝나면 기록으로 보관되고 그 안에 최종
 * 수치가 남으므로, 영구히 남는 값(소지금 · 가방 · 시트)을 먼저 덮었다.
 */

/** 무엇을 한 일인가 */
export type AuditAction =
  /** 소지금 지급 · 차감 */
  | 'POINTS'
  /** 보급품 지급 · 회수 */
  | 'ITEM'
  /** 운영진이 대신 구매 · 반납 */
  | 'TRADE'
  /** 시트 저장 (스탯 · 스킬 · 컨셉) */
  | 'SHEET'
  /** 시트 삭제 */
  | 'SHEET_DELETE'
  /** 기록 정산 — 여러 사람의 값을 한 번에 맞춘다 */
  | 'SETTLE';

export interface AuditEntry {
  id: string;
  at: string;
  /** 고친 사람 — 서버는 세션에서 채운다. 계정이 지워져도 활동명은 남는다 */
  byHandle: string;
  /** 고쳐진 사람 */
  targetAccountId: string;
  /** 그때의 이름 — 나중에 시트가 바뀌어도 기록은 그 시점을 가리켜야 한다 */
  targetName: string;
  action: AuditAction;
  /** 사람이 읽는 한 줄 */
  summary: string;
  /** 왜 고쳤는가 — 운영진이 적는다. 비워 둘 수 있다 */
  reason: string | null;
  /** 되짚을 수 있게 숫자를 남긴다. 숫자가 없는 일(시트 저장)은 null */
  before: number | null;
  after: number | null;
}

/** 남길 때는 시각과 고친 사람을 적지 않는다 — 그 둘은 저장 계층이 채운다 */
export type AuditDraft = Omit<AuditEntry, 'id' | 'at' | 'byHandle'>;

export interface AuditPort {
  /**
   * 한 줄 남긴다.
   *
   * **여기서 실패해도 부르는 쪽을 멈추지 않는다.** 기록이 안 남는 것보다
   * 지급이 반쯤 되고 마는 것이 나쁘다 — 실패는 삼키고 화면에만 알린다.
   */
  record(draft: AuditDraft): Promise<void>;
  /** 최근 기록 — 운영진만 읽는다 */
  listAudit(limit?: number): Promise<AuditEntry[]>;
}
