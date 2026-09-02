/**
 * 사람 단위 시트·지갑 조작.
 *
 * 명부(ROSTER)와 시트 열람(SHEET) 두 탭이 같은 창구를 연다 —
 * 한쪽에서만 고치면 같은 조작이 화면마다 다르게 동작하게 되므로 한 곳에 둔다.
 *
 * 소지금과 가방은 **개인 소유**다. 페어가 아니라 사람에게 붙인다.
 *
 * 여기를 지나는 모든 조작은 **감사 기록에 한 줄 남는다.** 운영진이 남의 소지금을
 * 고칠 수 있다는 것 자체는 필요한 권한이지만, 그 사실이 어디에도 남지 않으면
 * 「내 포인트가 왜 줄었냐」는 말에 답할 근거가 없다.
 */

import { findItem } from '../../config/items';
import { addItem } from '../../engine/items';
import { purchase, refund, withPurchase } from '../../engine/shop';
import type { OpsShell } from './OpsContext';
import { confirmed } from './shared';
import type { AuditDraft, SheetRecord } from '../../store';
import type { CharacterSheet } from '../../types';

/**
 * 배선(ops)을 **인자로 받는다** — 작전실 본체는 Provider 를 세우는 쪽이라
 * 자기 자신의 컨텍스트를 읽을 수 없다. 탭에서는 useOps() 결과를 그대로 넘긴다.
 */
export function useSheetAdmin(
  ops: OpsShell,
  /** 저장·삭제가 끝난 뒤 편집 칸을 닫는 등, 부르는 쪽이 정리할 일이 있으면 넘긴다 */
  onSettled?: () => void,
) {
  const { accounts, audit, guard, refresh, setMessage, setError } = ops;

  /**
   * 감사 기록 한 줄.
   *
   * **실패해도 여기서 멈추지 않는다.** 기록이 안 남는 것보다 지급이 반쯤 되고 마는 것이
   * 나쁘다 — 이미 시트는 고쳐진 뒤다. 실패는 화면에만 알린다.
   */
  const trail = async (draft: AuditDraft) => {
    try {
      await audit.record(draft);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `조작은 됐지만 기록에 남지 않았습니다: ${caught.message}`
          : '조작은 됐지만 기록에 남지 않았습니다.',
      );
    }
  };

  const saveSheet = async (accountId: string, next: CharacterSheet, reason?: string) => {
    await guard(async () => {
      await accounts.updateSheet(accountId, next);
      await trail({
        targetAccountId: accountId,
        targetName: next.name,
        action: 'SHEET',
        summary: `시트 저장 — ${next.classId}`,
        reason: reason?.trim() || null,
        before: null,
        after: null,
      });
      await refresh();
      onSettled?.();
      setMessage(`${next.name} 시트를 저장했습니다.`);
    });
  };

  const deleteSheet = async (accountId: string, sheet: CharacterSheet, bondLabel?: string) => {
    const warning = bondLabel
      ? `${sheet.name} (@${accountId}) 의 시트를 삭제합니다.\n이 참가자는 ${bondLabel} 에 편성되어 있습니다 — 편성 기록은 남습니다.\n되돌릴 수 없습니다.`
      : `${sheet.name} (@${accountId}) 의 시트를 삭제합니다. 되돌릴 수 없습니다.`;
    if (!confirmed(warning)) return;

    await guard(async () => {
      await accounts.deleteSheet(sheet.id);
      await trail({
        targetAccountId: accountId,
        targetName: sheet.name,
        action: 'SHEET_DELETE',
        summary: `시트 삭제 — 소지금 ${sheet.points ?? 0} P 와 가방이 함께 사라짐`,
        reason: bondLabel ? `편성: ${bondLabel}` : null,
        before: sheet.points ?? 0,
        after: null,
      });
      await refresh();
      onSettled?.();
      setMessage(`${sheet.name} 시트를 삭제했습니다.`);
    });
  };

  /** 소지금과 가방은 개인 것이라, 창구도 사람 단위로 연다 */
  const buyForSheet = async (row: SheetRecord, itemId: string) => {
    const result = purchase(row.sheet, itemId, 1);
    if (!result.ok) {
      setError(result.reason ?? '구매에 실패했습니다.');
      return;
    }
    await guard(async () => {
      const next = withPurchase(row.sheet, result);
      await accounts.updateSheet(row.accountId, next);
      await trail({
        targetAccountId: row.accountId,
        targetName: row.sheet.name,
        action: 'TRADE',
        summary: `운영진 대리 구매 — ${findItem(itemId)?.nameKo ?? itemId}`,
        reason: null,
        before: row.sheet.points ?? 0,
        after: next.points ?? 0,
      });
      await refresh();
      setMessage(`${row.sheet.name} — ${result.message}`);
    });
  };

  const sellForSheet = async (row: SheetRecord, itemId: string) => {
    const result = refund(row.sheet, itemId);
    if (!result.ok) {
      setError(result.reason ?? '반납에 실패했습니다.');
      return;
    }
    await guard(async () => {
      const next = withPurchase(row.sheet, result);
      await accounts.updateSheet(row.accountId, next);
      await trail({
        targetAccountId: row.accountId,
        targetName: row.sheet.name,
        action: 'TRADE',
        summary: `운영진 대리 반납 — ${findItem(itemId)?.nameKo ?? itemId}`,
        reason: null,
        before: row.sheet.points ?? 0,
        after: next.points ?? 0,
      });
      await refresh();
      setMessage(`${row.sheet.name} — ${result.message}`);
    });
  };

  /**
   * 소지금 부여 · 차감 — 운영진 권한.
   *
   * 참가자는 상점(shop_trade)을 거쳐야 소지금이 바뀌지만, 운영진은 창구를 직접 연다.
   * 편성 여부와 상관없이 시트가 있는 사람이면 누구에게나 줄 수 있다.
   *
   * 사유는 비워 둘 수 있지만, 분쟁이 나면 그 칸이 유일한 근거가 된다.
   */
  const giveSheetPoints = async (row: SheetRecord, delta: number, reason?: string) => {
    if (delta === 0) return;
    const before = row.sheet.points ?? 0;
    const next = Math.max(0, before + delta);
    await guard(async () => {
      await accounts.updateSheet(row.accountId, { ...row.sheet, points: next });
      await trail({
        targetAccountId: row.accountId,
        targetName: row.sheet.name,
        action: 'POINTS',
        summary: `소지금 ${delta > 0 ? '+' : ''}${delta} P`,
        reason: reason?.trim() || null,
        before,
        after: next,
      });
      await refresh();
      setMessage(`${row.sheet.name} 소지금 ${delta > 0 ? '+' : ''}${delta} P — ${before} → ${next}`);
    });
  };

  /** 보급품 지급 · 회수 — 값을 받지 않고 그냥 준다 */
  const giveSheetItem = async (
    row: SheetRecord,
    itemId: string,
    delta: number,
    reason?: string,
  ) => {
    const item = findItem(itemId);
    if (!item || delta === 0) return;
    const inventory = addItem(row.sheet.inventory ?? [], itemId, delta);
    await guard(async () => {
      await accounts.updateSheet(row.accountId, { ...row.sheet, inventory });
      await trail({
        targetAccountId: row.accountId,
        targetName: row.sheet.name,
        action: 'ITEM',
        summary: `${item.nameKo} ${delta > 0 ? `지급 ×${delta}` : `회수 ×${-delta}`}`,
        reason: reason?.trim() || null,
        before: null,
        after: null,
      });
      await refresh();
      setMessage(
        `${row.sheet.name} — ${item.nameKo} ${delta > 0 ? `지급 ×${delta}` : `회수 ×${-delta}`}`,
      );
    });
  };

  return { saveSheet, deleteSheet, buyForSheet, sellForSheet, giveSheetPoints, giveSheetItem };
}
