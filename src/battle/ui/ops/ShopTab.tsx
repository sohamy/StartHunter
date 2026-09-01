/**
 * 상점 진열 탭.
 *
 * 여기서 넣은 품목이 곧 참가자 상점의 선반이고, 전투 판정이 보는 아이템 정의다 —
 * 진열과 규칙이 같은 목록을 보게 하려고 저장 뒤에는 반드시 전체를 다시 읽는다.
 */

import { shopRows } from '../../config/shop';
import ShopEditor from '../ShopEditor';
import { useOps } from './OpsContext';
import { confirmed } from './shared';
import type { ShopItemRecord } from '../../types';

export default function ShopTab({ shopItems }: { shopItems: ShopItemRecord[] }) {
  const { shop, busy, guard, refresh, setMessage } = useOps();

  const saveShopRow = async (record: ShopItemRecord) => {
    await guard(async () => {
      await shop.saveItem(record);
      await refresh();
      setMessage(`상점에 반영했습니다 — ${record.item?.nameKo ?? record.itemId}`);
    });
  };

  const removeShopRow = async (itemId: string) => {
    if (!confirmed(`${itemId} 을(를) 진열에서 지웁니다.`)) return;
    await guard(async () => {
      await shop.deleteItem(itemId);
      await refresh();
      setMessage('진열에서 지웠습니다.');
    });
  };

  return (
    <section className="panel">
      <div className="process-head">
        <h2 className="panel-title">상점 진열 · {shopRows().length}</h2>
        <button type="button" className="ctl small" onClick={() => void refresh()}>
          새로 고침
        </button>
      </div>
      <p className="hint" style={{ marginBottom: 14 }}>
        여기서 넣은 품목은 참가자 상점(<code>/battle/shop/</code>)과 보급 창구에 바로 뜹니다.
        새로 만든 아이템도 전투에서 그대로 쓰입니다 — 효과는 아래 칸에 적은 값으로 판정합니다.
      </p>
      <ShopEditor
        records={shopItems}
        busy={busy}
        onSave={(record) => void saveShopRow(record)}
        onDelete={(itemId) => void removeShopRow(itemId)}
      />
    </section>
  );
}
