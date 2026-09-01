/**
 * 저장 계층 선택 지점.
 *
 * Supabase 환경 변수가 있으면 서버 구현을 쓰고, 없으면 LocalStorage 로 떨어진다.
 *
 * 화면이 무엇을 부르는지가 이 파일의 요점이다.
 *
 *   getStorage()   전투 · 편성 · 적 · 기록 · 채팅 — 세계 데이터
 *   getAccounts()      계정 · 세션 · 시트 · 선물 — 사람에게 붙는 것
 *   getShop()      보급 상점 **한 도메인 전부** (선반 + 창구)
 *   getRoulette()  운명 도박장 **한 도메인 전부** (원반 + 창구)
 *
 * 뒤의 둘은 구현이 두 클래스에 걸쳐 있다. 세계 데이터(무엇을 파는가 · 어떤 원반이
 * 열렸는가)는 저장소가 갖고, 사람의 지갑을 건드리는 일(사고팔기 · 돌리기)은 계정 쪽이
 * 갖기 때문이다 — 서버 모드에서는 후자가 세션을 요구하는 RPC 다.
 *
 * 그 사정이 화면까지 올라올 이유는 없다. 예전에는 도박장 화면이 원반은 storage 에서,
 * 돌리기는 auth 에서 따로 꺼냈고, 그래서 도박장 기능 하나를 고치려면 어느 파일을
 * 봐야 하는지 매번 다시 찾아야 했다. 여기서 묶어 하나로 내준다.
 */

import { applyShopCatalog } from '../config/shop';
import { LocalAccountAdapter } from './LocalAccountAdapter';
import { LocalStorageAdapter } from './LocalStorageAdapter';
import { SupabaseAccountAdapter } from './SupabaseAccountAdapter';
import { SupabaseStorageAdapter } from './SupabaseStorageAdapter';
import { hasSupabase } from './supabaseClient';
import type { AccountAdapter } from './AccountAdapter';
import type { RouletteCatalog, RouletteCounter, RoulettePort } from './ports/RoulettePort';
import type { ShopCatalog, ShopCounter, ShopPort } from './ports/ShopPort';
import type { StorageAdapter } from './StorageAdapter';

/** 저장소 구현이 실제로 갖춰야 하는 것 — 세계 데이터에 선반과 원반이 얹힌다 */
export type StorageImplementation = StorageAdapter & ShopCatalog & RouletteCatalog;
/** 계정 구현 — 계정에 두 창구가 얹힌다 */
export type AccountImplementation = AccountAdapter & ShopCounter & RouletteCounter;

let storageAdapter: StorageImplementation | null = null;
let accountAdapter: AccountImplementation | null = null;
let shopPort: ShopPort | null = null;
let roulettePort: RoulettePort | null = null;

/** 서버(Supabase)에 연결된 상태인지 — UI 에서 안내 문구를 바꾸는 데 쓴다. */
export function isServerMode(): boolean {
  return hasSupabase();
}

function storageImpl(): StorageImplementation {
  if (!storageAdapter) {
    storageAdapter = hasSupabase() ? new SupabaseStorageAdapter() : new LocalStorageAdapter();
  }
  return storageAdapter;
}

function accountImpl(): AccountImplementation {
  if (!accountAdapter) {
    accountAdapter = hasSupabase() ? new SupabaseAccountAdapter() : new LocalAccountAdapter();
  }
  return accountAdapter;
}

export function getStorage(): StorageAdapter {
  return storageImpl();
}

export function getAccounts(): AccountAdapter {
  return accountImpl();
}

/**
 * 보급 상점 한 도메인.
 *
 * 선반은 저장소에서, 창구는 계정 쪽에서 온다. 부르는 쪽은 그 경계를 몰라도 된다.
 */
export function getShop(): ShopPort {
  if (!shopPort) {
    const shelf = storageImpl();
    const counter = accountImpl();
    shopPort = {
      listItems: () => shelf.listItems(),
      saveItem: (record) => shelf.saveItem(record),
      deleteItem: (itemId) => shelf.deleteItem(itemId),
      trade: (itemId, kind) => counter.trade(itemId, kind),
      useSupply: (itemId) => counter.useSupply(itemId),
    };
  }
  return shopPort;
}

/** 운명 도박장 한 도메인. 상점과 같은 방식으로 묶는다. */
export function getRoulette(): RoulettePort {
  if (!roulettePort) {
    const hall = storageImpl();
    const counter = accountImpl();
    roulettePort = {
      listWheels: () => hall.listWheels(),
      saveWheel: (wheel) => hall.saveWheel(wheel),
      deleteWheel: (id) => hall.deleteWheel(id),
      recentSpins: (limit) => hall.recentSpins(limit),
      deleteSpin: (id) => hall.deleteSpin(id),
      clearSpins: () => hall.clearSpins(),
      spin: (wheelId) => counter.spin(wheelId),
    };
  }
  return roulettePort;
}

/**
 * 상점 진열을 저장소에서 읽어 config 에 싣는다.
 *
 * 화면이 열릴 때 한 번 부른다. 실패하면 기본 목록으로 간다 —
 * 상점 때문에 화면 전체가 멈추지는 않게 한다.
 */
export async function loadShopCatalog(): Promise<void> {
  try {
    applyShopCatalog(await getShop().listItems());
  } catch {
    applyShopCatalog([]);
  }
}

/** 서버 모드일 때만 쓸 수 있는 확장 기능 (쪽별 제출) */
export function getServerStorage(): SupabaseStorageAdapter | null {
  const storage = storageImpl();
  return storage instanceof SupabaseStorageAdapter ? storage : null;
}

export function getServerAccounts(): SupabaseAccountAdapter | null {
  const auth = accountImpl();
  return auth instanceof SupabaseAccountAdapter ? auth : null;
}

/** 테스트나 다른 백엔드 연동 시 구현체를 갈아끼운다. 묶어 둔 도메인도 함께 버린다. */
export function setStorage(next: StorageImplementation): void {
  storageAdapter = next;
  shopPort = null;
  roulettePort = null;
}

export function setAccounts(next: AccountImplementation): void {
  accountAdapter = next;
  shopPort = null;
  roulettePort = null;
}

export { AuthError, toPublicProfile } from './AccountAdapter';
export type {
  AccountAdapter,
  Credentials,
  PublicProfile,
  RegisterInput,
  SheetRecord,
} from './AccountAdapter';
export type { PublicPair, StorageAdapter } from './StorageAdapter';
export type {
  RouletteCatalog,
  RouletteCounter,
  RoulettePort,
  SpinOutcome,
} from './ports/RoulettePort';
export type {
  ShopCatalog,
  ShopCounter,
  ShopPort,
  TradeKind,
  TradeResult,
  UseSupplyOutcome,
} from './ports/ShopPort';
