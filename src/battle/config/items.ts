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

import { CONSTELLATION_STATS, HUNTER_STATS } from './characters';
import type { Affiliation, ItemDefinition, StatBlock } from '../types';

/** 스탯 키를 사람이 읽는 이름으로 — 강화 아이템 설명에 쓴다 */
export function statLabel(key: string): string {
  const def = [...HUNTER_STATS, ...CONSTELLATION_STATS].find((row) => row.key === key);
  return def ? `${def.labelKo}(${def.label})` : key;
}

/** 이 아이템이 올려 주는 능력치. 없으면 null */
export function statGainOf(item: ItemDefinition | null): StatBlock | null {
  const gain = item?.effect.statGain;
  if (!gain) return null;
  const rows = Object.entries(gain).filter(([, amount]) => amount > 0);
  return rows.length > 0 ? Object.fromEntries(rows) : null;
}

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
    id: 'item.stim',
    name: 'COMBAT STIM',
    nameKo: '전투 각성제',
    category: 'HUNTER_ONLY',
    description: '한 판만 몸을 끌어올린다. 끝나면 그대로 가라앉는다.',
    target: 'SELF',
    apCost: 1,
    combatUsable: true,
    effect: { applyStatusIds: ['stat.surge'] },
  },

  /* ── 영구 강화 ─────────────────────────────────────────
     전투 중에는 쓸 수 없다 — 보급 창구에서 쓰고, 시트의 능력치가 영구히 오른다.
     statCap 은 한 스탯에 쌓을 수 있는 보너스 상한이며 운영진이 진열에서 고친다.

     주의 — 이 다섯 품목의 정의는 서버(supabase/migrations/0017)의 shop_items 에도
     같은 값으로 심는다. 사용 판정을 서버가 하므로 서버에도 정의가 있어야 한다.
     값을 고칠 때는 작전실 진열에서 고치면 되고, 그 값이 코드보다 우선한다. */
  {
    id: 'item.train.str',
    name: 'STRENGTH CORE',
    nameKo: '근력 단련석',
    category: 'HUNTER_ONLY',
    description: '삼키면 근육이 다시 짜인다. 몸에 남는다.',
    target: 'SELF',
    apCost: 0,
    combatUsable: false,
    effect: { statGain: { str: 1 }, statCap: 3 },
  },
  {
    id: 'item.train.vit',
    name: 'VITALITY CORE',
    nameKo: '체력 강화제',
    category: 'HUNTER_ONLY',
    description: '버티는 몸을 만든다. 몸에 남는다.',
    target: 'SELF',
    apCost: 0,
    combatUsable: false,
    effect: { statGain: { vit: 1 }, statCap: 3 },
  },
  {
    id: 'item.train.agi',
    name: 'AGILITY CORE',
    nameKo: '민첩 촉진제',
    category: 'HUNTER_ONLY',
    description: '반응이 한 박자 빨라진다. 몸에 남는다.',
    target: 'SELF',
    apCost: 0,
    combatUsable: false,
    effect: { statGain: { agi: 1 }, statCap: 3 },
  },
  {
    id: 'item.train.authority',
    name: 'AUTHORITY CRYSTAL',
    nameKo: '권능 응결정',
    category: 'CONSTELLATION_ONLY',
    description: '성유물. 흩어진 권능을 한 겹 더 굳힌다.',
    target: 'SELF',
    apCost: 0,
    combatUsable: false,
    effect: { statGain: { authority: 1 }, statCap: 3 },
  },
  {
    id: 'item.train.divinity',
    name: 'DIVINITY SHARD',
    nameKo: '신격의 편린',
    category: 'CONSTELLATION_ONLY',
    description: '성유물. 격이 한 뼘 올라간다.',
    target: 'SELF',
    apCost: 0,
    combatUsable: false,
    effect: { statGain: { divinity: 1 }, statCap: 3 },
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
  if (effect.statGain) {
    for (const [key, amount] of Object.entries(effect.statGain)) {
      if (!amount) continue;
      lines.push(`${statLabel(key)} +${amount} (영구)`);
    }
    if (effect.statCap) lines.push(`강화 상한 +${effect.statCap}`);
  }
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
