/**
 * 사람 단위 시트·지갑 조작.
 *
 * 명부(ROSTER)와 시트 열람(SHEET) 두 탭이 같은 창구를 연다 —
 * 한쪽에서만 고치면 같은 조작이 화면마다 다르게 동작하게 되므로 한 곳에 둔다.
 *
 * 소지금과 가방은 **개인 소유**다. 페어가 아니라 사람에게 붙인다.
 */

import { findItem } from '../../config/items';
import { addItem } from '../../engine/items';
import { purchase, refund, withPurchase } from '../../engine/shop';
import type { OpsShell } from './OpsContext';
import { confirmed } from './shared';
import type { SheetRecord } from '../../store';
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
  const { accounts, guard, refresh, setMessage, setError } = ops;

  const saveSheet = async (accountId: string, next: CharacterSheet) => {
    await guard(async () => {
      await accounts.updateSheet(accountId, next);
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
      await accounts.updateSheet(row.accountId, withPurchase(row.sheet, result));
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
      await accounts.updateSheet(row.accountId, withPurchase(row.sheet, result));
      await refresh();
      setMessage(`${row.sheet.name} — ${result.message}`);
    });
  };

  /**
   * 소지금 부여 · 차감 — 운영진 권한.
   *
   * 참가자는 상점(shop_trade)을 거쳐야 소지금이 바뀌지만, 운영진은 창구를 직접 연다.
   * 편성 여부와 상관없이 시트가 있는 사람이면 누구에게나 줄 수 있다.
   */
  const giveSheetPoints = async (row: SheetRecord, delta: number) => {
    if (delta === 0) return;
    const next = Math.max(0, (row.sheet.points ?? 0) + delta);
    await guard(async () => {
      await accounts.updateSheet(row.accountId, { ...row.sheet, points: next });
      await refresh();
      setMessage(
        `${row.sheet.name} 소지금 ${delta > 0 ? '+' : ''}${delta} P — ${row.sheet.points ?? 0} → ${next}`,
      );
    });
  };

  /** 보급품 지급 · 회수 — 값을 받지 않고 그냥 준다 */
  const giveSheetItem = async (row: SheetRecord, itemId: string, delta: number) => {
    const item = findItem(itemId);
    if (!item || delta === 0) return;
    const inventory = addItem(row.sheet.inventory ?? [], itemId, delta);
    await guard(async () => {
      await accounts.updateSheet(row.accountId, { ...row.sheet, inventory });
      await refresh();
      setMessage(
        `${row.sheet.name} — ${item.nameKo} ${delta > 0 ? `지급 ×${delta}` : `회수 ×${-delta}`}`,
      );
    });
  };

  return { saveSheet, deleteSheet, buyForSheet, sellForSheet, giveSheetPoints, giveSheetItem };
}
