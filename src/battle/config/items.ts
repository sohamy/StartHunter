/**
 * 아이템 정의.
 *
 * 요구사항서 15장의 데이터 항목을 그대로 담는다 —
 * 이름 · 종류 · 설명 · 대상 · 사용 효과 · 행동력 비용 · 보유 개수 · 전투 중 사용 가능 여부.
 *
 * 보유 개수는 전투 상태(ItemStack)에 있고, 여기에는 "무엇인가"만 둔다.
 * 새 아이템을 추가할 때 엔진 코드를 고칠 필요가 없어야 한다 —
 * 엔진은 `effect` 필드를 해석할 뿐 개별 아이템 이름을 알지 않는다.
 */

import type { Affiliation, ItemDefinition } from '../types';

export const ITEM_RULES = {
  /** 아이템 하나가 쌓일 수 있는 최대 개수 */
  maxQuantity: 9,
} as const;

/** 분류별 표기 */
export const ITEM_CATEGORY_LABELS = {
  HUNTER_ONLY: { label: 'HUNTER', labelKo: '헌터 전용' },
  CONSTELLATION_ONLY: { label: 'CONSTELLATION', labelKo: '성좌 전용' },
  SHARED: { label: 'SHARED', labelKo: '공용' },
  AFFILIATION: { label: 'AFFILIATION', labelKo: '진영 전용' },
  KEY: { label: 'KEY ITEM', labelKo: '중요 아이템' },
} as const;

export const ITEM_DEFINITIONS: ItemDefinition[] = [
  {
    id: 'item.medkit',
    name: 'FIELD MEDKIT',
    nameKo: '응급 처치 키트',
    category: 'HUNTER_ONLY',
    description: '지정한 헌터의 상처를 임시로 봉합한다.',
    target: 'ALLY',
    apCost: 1,
    combatUsable: true,
    effect: { healPercent: 0.35 },
  },
  {
    id: 'item.antidote',
    name: 'PURGE SHOT',
    nameKo: '해독 주사',
    category: 'HUNTER_ONLY',
    description: '몸에 남은 지속 피해를 씻어낸다.',
    target: 'SELF',
    apCost: 1,
    combatUsable: true,
    effect: { cureKinds: ['DOT'] },
  },
  {
    id: 'item.smoke',
    name: 'ASH SCREEN',
    nameKo: '연막탄',
    category: 'SHARED',
    description: '재를 흩뿌려 이번 교전의 시야를 가린다.',
    target: 'SELF',
    apCost: 1,
    combatUsable: true,
    effect: { applyStatusIds: ['guard.up'] },
  },
  {
    id: 'item.starfruit',
    name: 'STAR FRAGMENT',
    nameKo: '별의 조각',
    category: 'SHARED',
    description: '삼키면 소진된 힘이 잠시 돌아온다.',
    target: 'SELF',
    apCost: 0,
    combatUsable: true,
    effect: { restoreAp: 2 },
  },
  {
    id: 'item.grenade',
    name: 'SIGIL CHARGE',
    nameKo: '성흔 파열탄',
    category: 'SHARED',
    description: '성흔을 새긴 폭약. 적에게 직접 피해를 준다.',
    target: 'ENEMY',
    apCost: 1,
    combatUsable: true,
    effect: { damage: 45, applyStatusIds: ['burn'] },
  },
  {
    id: 'item.lifeline',
    name: 'RETURN THREAD',
    nameKo: '귀환의 실',
    category: 'HUNTER_ONLY',
    description: '전투 불능이 된 헌터를 끌어올린다. 구조 행동보다 확실하다.',
    target: 'ALLY',
    apCost: 1,
    combatUsable: true,
    effect: { revivePercent: 0.5, applyStatusIds: ['guard.up'] },
  },
  {
    id: 'item.censer',
    name: 'ASH CENSER',
    nameKo: '재의 향로',
    category: 'CONSTELLATION_ONLY',
    description: '성유물. 흐트러진 계약을 다시 이어 붙인다.',
    target: 'SELF',
    apCost: 1,
    combatUsable: true,
    effect: { contractRepair: 18 },
  },
  {
    id: 'item.anchor',
    name: 'MOORING NAIL',
    nameKo: '정박의 못',
    category: 'CONSTELLATION_ONLY',
    description: '성유물. 무너지던 존재를 한 단계 붙잡아 세운다.',
    target: 'SELF',
    apCost: 2,
    combatUsable: true,
    effect: { stageRepair: 1, contractRepair: 6 },
  },
  {
    id: 'item.badge.government',
    name: 'BUREAU SEAL',
    nameKo: '관리국 인증패',
    category: 'AFFILIATION',
    affiliation: 'GOVERNMENT',
    description: '관리국 지원 요청 신호. 규정된 화력 지원이 내려온다.',
    target: 'SELF',
    apCost: 1,
    combatUsable: true,
    effect: { applyStatusIds: ['atk.up.great'] },
  },
  {
    id: 'item.charm.guild',
    name: 'GUILD CHARM',
    nameKo: '길드 부적',
    category: 'AFFILIATION',
    affiliation: 'PRIVATE_GUILD',
    description: '민간 길드가 돌려 쓰는 부적. 규정에는 없지만 잘 듣는다.',
    target: 'SELF',
    apCost: 1,
    combatUsable: true,
    effect: { healPercent: 0.15, applyStatusIds: ['guard.up'] },
  },
  {
    id: 'item.floorpass',
    name: 'FLOOR CLEARANCE',
    nameKo: '층 통행 인가',
    category: 'KEY',
    description: '상위 층으로 올라가는 데 필요한 인가증. 전투 중에는 쓸 수 없다.',
    target: 'NONE',
    apCost: 0,
    combatUsable: false,
    effect: {},
  },
];

/* ── 운영진이 직접 넣은 품목 ───────────────────────────
   기본 품목은 위 배열에 있고, 운영진이 작전실에서 만든 품목은 저장소에서 온다.
   화면과 엔진은 개별 아이템을 이름으로 알지 않으므로, 목록만 갈아 끼우면 된다.

   여기 담긴 값은 앱이 켜질 때 store 에서 한 번 실어 준다 (applyItemCatalog).
   전투 판정도 이 목록을 거치므로, 운영진이 만든 아이템도 전투에서 그대로 쓰인다. */

let customItems: ItemDefinition[] = [];

/** 저장소에서 읽어 온 운영진 품목을 싣는다. 화면 진입 때 한 번 부른다. */
export function applyItemCatalog(items: ItemDefinition[]): void {
  customItems = items;
}

/** 기본 품목 + 운영진 품목. 같은 id 면 운영진 쪽이 이긴다. */
export function allItems(): ItemDefinition[] {
  const overridden = new Set(customItems.map((row) => row.id));
  return [...ITEM_DEFINITIONS.filter((row) => !overridden.has(row.id)), ...customItems];
}

export function findItem(itemId: string | null): ItemDefinition | null {
  if (!itemId) return null;
  return allItems().find((row) => row.id === itemId) ?? null;
}

/** 이 주체 · 이 진영이 들 수 있는 아이템 */
export function itemsFor(
  side: 'HUNTER' | 'CONSTELLATION',
  affiliation: Affiliation,
): ItemDefinition[] {
  return allItems().filter((item) => allowedFor(item, side, affiliation));
}

export function allowedFor(
  item: ItemDefinition,
  side: 'HUNTER' | 'CONSTELLATION',
  affiliation: Affiliation,
): boolean {
  if (item.category === 'HUNTER_ONLY' && side !== 'HUNTER') return false;
  if (item.category === 'CONSTELLATION_ONLY' && side !== 'CONSTELLATION') return false;
  if (item.category === 'AFFILIATION' && item.affiliation && item.affiliation !== affiliation) {
    return false;
  }
  return true;
}

/** 효과를 사람이 읽는 문장으로 — UI 와 로그가 함께 쓴다 */
export function describeItem(item: ItemDefinition): string[] {
  const lines: string[] = [];
  const { effect } = item;
  if (effect.healPercent) lines.push(`HP ${Math.round(effect.healPercent * 100)}% 회복`);
  if (effect.healHp) lines.push(`HP ${effect.healHp} 회복`);
  if (effect.revivePercent) {
    lines.push(`전투 불능 복귀 (HP ${Math.round(effect.revivePercent * 100)}%)`);
  }
  if (effect.restoreAp) lines.push(`행동력 +${effect.restoreAp}`);
  if (effect.damage) lines.push(`적에게 피해 ${effect.damage}`);
  if (effect.contractRepair) lines.push(`계약 안정도 +${effect.contractRepair}`);
  if (effect.stageRepair) lines.push(`성좌 상태 ${effect.stageRepair}단계 회복`);
  if (effect.cureKinds?.length) lines.push(`상태이상 해제 (${effect.cureKinds.join(' · ')})`);
  if (effect.applyStatusIds?.length) lines.push(`상태이상 부여 ${effect.applyStatusIds.join(' · ')}`);
  if (!item.combatUsable) lines.push('전투 중 사용 불가');
  return lines;
}

/** 페어가 전투를 시작할 때 기본으로 들고 들어가는 보급품 */
export const DEFAULT_INVENTORY: Array<{ itemId: string; quantity: number }> = [
  { itemId: 'item.medkit', quantity: 2 },
  { itemId: 'item.starfruit', quantity: 1 },
  { itemId: 'item.censer', quantity: 1 },
];
