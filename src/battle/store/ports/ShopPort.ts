/**
 * 보급 상점 — 한 도메인의 전부.
 *
 * 상점은 두 저장소에 걸쳐 있다. 감추지 않고 이름을 붙여 둔다.
 *
 *   · 선반(ShopCatalog) — 무엇을 파는가. 세계 데이터다. 로그인 없이도 읽힌다.
 *   · 창구(ShopCounter) — 사고팔고 쓰는 일. **사람의 지갑을 건드리므로** 세션이 필요하고,
 *     서버 모드에서는 값 계산과 최종 판정을 서버(shop_trade · use_supply)가 한다.
 *
 * 이 둘이 서로 다른 구현 클래스에 사는 것은 그래서다. 다만 **화면은 상점 하나만 본다** —
 * `getShop()` 이 둘을 하나로 묶어 준다. 예전에는 화면이 진열은 storage 에서,
 * 매매는 auth 에서 따로 꺼내 썼고, 그래서 상점 기능 하나를 고치려면 어디를 봐야 하는지
 * 매번 다시 찾아야 했다.
 */

import type { ItemStack, ShopItemRecord, StatBlock } from '../../types';

/** 사는 쪽인지 되파는 쪽인지 */
export type TradeKind = 'BUY' | 'SELL';

/** 사고판 뒤의 지갑 상태 */
export interface TradeResult {
  points: number;
  inventory: ItemStack[];
}

/** 강화 보급품을 쓴 뒤의 상태 — 능력치는 영구히 오른다 */
export interface UseSupplyOutcome {
  statBonus: StatBlock;
  inventory: ItemStack[];
}

/** 선반 — 운영진이 진열을 정한다 */
export interface ShopCatalog {
  listItems(): Promise<ShopItemRecord[]>;
  saveItem(record: ShopItemRecord): Promise<void>;
  deleteItem(itemId: string): Promise<void>;
}

/** 창구 — 값과 판정은 서버가 한다. 브라우저는 무엇을 사고팔지만 보낸다 */
export interface ShopCounter {
  trade(itemId: string, kind: TradeKind): Promise<TradeResult>;
  /** 강화 보급품 사용 — 전투 밖에서만 된다 */
  useSupply(itemId: string): Promise<UseSupplyOutcome>;
}

/** 화면이 보는 것 */
export type ShopPort = ShopCatalog & ShopCounter;
