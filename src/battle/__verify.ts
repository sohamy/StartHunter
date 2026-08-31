/* 검증 스크립트 — `npm run verify:battle` 로 실행한다. */
import { ALL_ACTIONS, findAction } from './config/actions';
import { AUTO_FORBIDDEN_KINDS } from './config/autoAction';
import {
  CONSTELLATION_CLASSES,
  CONSTELLATION_STATS,
  HUNTER_CLASSES,
  HUNTER_STATS,
  POINT_BUY,
  initialStats,
  remainingPoints,
} from './config/characters';
import { GIMMICK_CHECK } from './config/gimmicks';
import { ITEM_RULES } from './config/items';
import {
  PATTERN_DEFINITIONS,
  PATTERN_SETS,
  findPattern,
  findPatternSet,
} from './config/patterns';
import { findReward, manualRewards } from './config/rewards';
import { CONTRACT_RULES, CURRENT_PHASE, SCHEMA_VERSION } from './config/rules';
import { pairPreset, presetSheet } from './config/scenario';
import { SKILL_KINDS } from './config/skills';
import * as admin from './engine/admin';
import { createBattle, viewerPair } from './engine/battle';
import {
  constellationStateFromSheet,
  deriveConstellation,
  deriveHunter,
  hunterStateFromSheet,
  validateSheet,
} from './engine/character';
import { previewCombo } from './engine/combo';
import { formatDice, parseDice, rollDice } from './engine/dice';
import {
  evaluatePhase,
  normalizeCutoffs,
  patternSchedule,
  patternSetToPreset,
  phaseBands,
  selectPattern,
} from './engine/enemy';
import { declarationValid, planCheck, rollCheck } from './engine/gimmick';
import { addItem, inventoryFor, itemAvailability, quantityOf } from './engine/items';
import { buildRecord, settle, settleable, type SettlementTarget } from './engine/record';
import { earnedBy } from './engine/rewards';
import {
  actionAvailability,
  applyRound,
  previewRound,
  setControlMode,
  submitPairAction,
} from './engine/round';
import { purchase, refund, withPurchase, type Wallet } from './engine/shop';
import { skillToAction, toRuntime } from './engine/skills';
import {
  aggregateModifiers,
  applyStatus,
  canManifest,
  contractFromValue,
  contractPowerMultiplier,
  contractStageOf,
  injuryOf,
  shiftStage,
  tickStatuses,
} from './engine/status';
import {
  buffAmplifier,
  canLastStand,
  contractRecovery,
  healBonus,
  manifestPower,
  protectAmplifier,
  recoilRelief,
  rescueBonus,
  revelationShared,
  statusDurationBonus,
  statusResistRounds,
  weakPointBonus,
} from './engine/traits';
import type {
  BattleState,
  CharacterSheet,
  CustomAttack,
  PairBond,
  SkillDefinition,
} from './types';

let failures = 0;
function check(label: string, condition: boolean, extra = '') {
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
}

const HUNTER_SKILLS: SkillDefinition[] = [
  {
    id: 'SK-TEST-H1',
    side: 'HUNTER',
    kind: 'ATTACK',
    name: 'TEST SLASH',
    description: '',
    apCost: 2,
    target: 'ENEMY',
    power: 2,
    cooldown: 2,
    maxUses: 1,
    applyStatusIds: ['bleed'],
    special: '',
  },
];

const hunterSheet: CharacterSheet = {
  id: 'TEST-H',
  side: 'HUNTER',
  name: '테스트 헌터',
  classId: 'guardian',
  stats: { str: 2, vit: 6, agi: 4, sen: 2, wil: 3 },
  skills: HUNTER_SKILLS,
  pairName: '',
  partnerName: '',
  personality: '',
  traits: '',
  contractStory: '',
  points: 0,
  inventory: [],
  affiliation: 'GOVERNMENT',
  createdAt: '1970-01-01T00:00:00.000Z',
};

const constellationSheet: CharacterSheet = {
  id: 'TEST-C',
  side: 'CONSTELLATION',
  name: '테스트 성좌',
  classId: 'calamity',
  stats: { authority: 6, divinity: 3, resonance: 1, observation: 4, manifest: 3 },
  skills: [],
  pairName: '',
  partnerName: '',
  personality: '',
  traits: '',
  contractStory: '',
  points: 0,
  inventory: [],
  affiliation: 'GOVERNMENT',
  createdAt: '1970-01-01T00:00:00.000Z',
};

/* ── 1. 캐릭터 시트 파생 ────────────────────────────── */
console.log('\n=== 1. 캐릭터 시트 파생 ===');
const derivedHunter = deriveHunter(hunterSheet);
check('VIT → 최대 HP', derivedHunter.maxHp === 133, `maxHp ${derivedHunter.maxHp}`);
check('STR + 클래스 → 공격력', derivedHunter.attack === 5, `attack ${derivedHunter.attack}`);
check('AGI + 클래스 → 방어력', derivedHunter.defense === 6, `defense ${derivedHunter.defense}`);

const derivedConst = deriveConstellation(constellationSheet);
check('AUT + 권역 → 권능 배율', derivedConst.power === 1.39, `power ${derivedConst.power}`);
check('DIV → 최대 행동력', derivedConst.maxAp === 6, `maxAp ${derivedConst.maxAp}`);

const hunterState = hunterStateFromSheet(hunterSheet);
check('시트 스킬이 런타임으로 변환', hunterState.skills.length === 1);
check('쿨타임 초기값 0', hunterState.skills[0].currentCooldown === 0);
check('사용 횟수 초기값', hunterState.skills[0].remainingUses === 1);
check('현신 사용 횟수 초기화', constellationStateFromSheet(constellationSheet).manifestUses.partial === 2);

/* ── 2. 시트 검증 ───────────────────────────────────── */
console.log('\n=== 2. 시트 검증 ===');
const blank = {
  side: 'HUNTER' as const,
  name: '',
  classId: '',
  stats: initialStats('HUNTER'),
  pairName: '',
  partnerName: '',
  personality: '',
  traits: '',
  contractStory: '',
  points: 0,
  inventory: [],
  skills: [],
};
check('빈 시트는 3개 오류', validateSheet(blank).length === 3);
check('배분 전 남은 포인트', remainingPoints('HUNTER', initialStats('HUNTER')) === POINT_BUY.freePoints);
check('완성된 시트는 오류 없음', validateSheet(hunterSheet).length === 0);
check(
  '이름 없는 스킬 감지',
  validateSheet({ ...hunterSheet, skills: [{ ...HUNTER_SKILLS[0], name: '' }] }).length === 1,
);
check(
  '범위 초과 스킬 감지',
  validateSheet({ ...hunterSheet, skills: [{ ...HUNTER_SKILLS[0], apCost: 9, power: 9 }] }).length === 2,
);

/* ── 3. 스킬 → 행동 변환 ────────────────────────────── */
console.log('\n=== 3. 스킬 변환 ===');
const skillAction = skillToAction(toRuntime(HUNTER_SKILLS)[0]);
check('ATTACK 스킬은 damage 효과', skillAction.effect.damage === 2);
check('상태이상이 효과에 포함', skillAction.effect.applyStatusIds?.[0] === 'bleed');
check('스킬 id 가 행동 id', skillAction.id === 'SK-TEST-H1');

/* ── 4. 상태이상 ────────────────────────────────────── */
console.log('\n=== 4. 상태이상 ===');
let statuses = applyStatus([], 'def.down', 'TEST');
check('부여 시 지속시간 설정', statuses[0].remainingRounds === 2);
statuses = applyStatus(statuses, 'def.down', 'TEST');
check('중첩 가능 상태이상은 쌓임', statuses[0].stacks === 2);
statuses = applyStatus(statuses, 'def.down', 'TEST');
check('최대 중첩 상한', statuses[0].stacks === 2);
check('중첩만큼 보정 합산', aggregateModifiers(statuses).defenseDown === 0.6);
const scaled = applyStatus([], 'atk.up', 'TEST', 1.5);
check(
  '배율이 보정에 반영',
  Math.abs((aggregateModifiers(scaled).attackUp ?? 0) - 0.45) < 1e-9,
  String(aggregateModifiers(scaled).attackUp),
);
const ticked = tickStatuses(tickStatuses(statuses).statuses);
check('지속시간 만료 시 제거', ticked.statuses.length === 0 && ticked.expired.length === 1);
check('행동 불가 상태 감지', aggregateModifiers(applyStatus([], 'bind', 'T')).blockAction === true);

/* ── 5. DUEL 라운드 + 스킬 쿨타임 ───────────────────── */
console.log('\n=== 5. 라운드 진행 · 쿨타임 ===');
let duel = createBattle({
  mode: 'DUEL',
  primaryPair: { hunterSheet, constellationSheet },
  gimmickId: null,
});
const pairId = duel.pairs[0].id;
duel = submitPairAction(duel, pairId, {
  hunterActionId: 'SK-TEST-H1',
  constellationActionId: 'const.debuff',
  hunterSubmitted: true,
  constellationSubmitted: true,
});

const duelPreview = previewRound(duel);
const row = duelPreview.pairs[0];
console.log('  근거:', row.notes.join(' | '));
check('커스텀 스킬로 피해 발생', row.damageToEnemy > 0, `damage=${row.damageToEnemy}`);
check('연계 성립 (STAR BREAK)', row.combo?.id === 'combo.star_break', row.combo?.label ?? 'none');
check('스킬 사용 기록', row.usedSkills[0]?.skillId === 'SK-TEST-H1');
check(
  '상태이상 부여 예정',
  row.appliedStatuses.map((s) => s.defId).sort().join(',') === 'bleed,def.down',
  row.appliedStatuses.map((s) => s.defId).join(','),
);

duel = applyRound(duel, duelPreview);
const hunterAfter = duel.pairs[0].hunter;
check('쿨타임 설정', hunterAfter.skills[0].currentCooldown === 1, `cd ${hunterAfter.skills[0].currentCooldown}`);
check('사용 횟수 차감', hunterAfter.skills[0].remainingUses === 0);
check('적에게 상태이상 유지', duel.enemies[0].statuses.length > 0, duel.enemies[0].statuses.map((s) => s.defId).join(','));
check('라운드 진행', duel.round === 2);

const duelPreview2 = previewRound(duel);
check(
  '쿨타임·사용횟수 소진 시 자동 대체',
  duelPreview2.pairs[0].hunterActionId !== 'SK-TEST-H1',
  String(duelPreview2.pairs[0].hunterActionId),
);
check('지속 피해 예상 포함', duelPreview2.statusTicks.length > 0, `${duelPreview2.statusTicks.length}건`);

/* ── 6. 연계 판정 ───────────────────────────────────── */
console.log('\n=== 6. 연계 ===');
const noCombo = previewCombo(
  { ...skillAction, effect: { damage: 1 } },
  {
    id: 'const.wait',
    side: 'CONSTELLATION',
    kind: 'WAIT',
    label: 'OBSERVE',
    labelKo: '관측',
    description: '',
    apCost: 0,
    target: 'NONE',
    effect: {},
    implementedIn: 1,
  },
  [],
);
check('관측 + 공격은 연계 없음', noCombo === null);

let combo = createBattle({ mode: 'DUEL', primaryPair: { hunterSheet, constellationSheet }, gimmickId: null });
combo = submitPairAction(combo, combo.pairs[0].id, {
  hunterActionId: 'hunter.defend',
  constellationActionId: 'const.buff',
  hunterSubmitted: true,
  constellationSubmitted: true,
});
const aegis = previewRound(combo).pairs[0];
check('방어 + 버프 → AEGIS LINK', aegis.combo?.id === 'combo.aegis', aegis.combo?.label ?? 'none');
check('연계 반격 피해', aegis.damageToEnemy > 0, `damage ${aegis.damageToEnemy}`);
check('연계 피해 감소 합산', aegis.damageReduction > 0.4, String(aegis.damageReduction));

/* ── 7. 구조 ────────────────────────────────────────── */
console.log('\n=== 7. 구조 ===');
let rescue = createBattle({ mode: 'RAID', pairCount: 2, gimmickId: null });
rescue = {
  ...rescue,
  pairs: [
    rescue.pairs[0],
    { ...rescue.pairs[1], hunter: { ...rescue.pairs[1].hunter, hp: 0 } },
  ],
};
rescue = submitPairAction(rescue, rescue.pairs[0].id, {
  hunterActionId: 'hunter.rescue',
  constellationActionId: 'const.buff',
  supportTargetPairId: rescue.pairs[1].id,
  hunterSubmitted: true,
  constellationSubmitted: true,
});
const rescuePreview = previewRound(rescue);
const rescueRow = rescuePreview.pairs[0];
check('구조 대상 인식', rescueRow.rescue?.targetPairId === rescue.pairs[1].id);
check('구조 연계 성립', rescueRow.combo?.id === 'combo.rescue', rescueRow.combo?.label ?? 'none');
rescue = applyRound(rescue, rescuePreview);
check('구조 후 HP 회복', rescue.pairs[1].hunter.hp > 0, `HP ${rescue.pairs[1].hunter.hp}`);
check(
  '구조 후 보호 상태이상',
  rescue.pairs[1].hunter.statuses.some((s) => s.defId === 'guard.up'),
);
check('구조 경보 발생', rescue.alerts.some((a) => a.title === 'HUNTER RECOVERED'));

/* ── 8. 기믹 — 파악 → 해결 ──────────────────────────── */
console.log('\n=== 8. 기믹 (파악 → 해결) ===');
let gimmick = createBattle({ mode: 'RAID', pairCount: 4 });
check('기본 기믹 배치', gimmick.gimmick?.defId === 'gimmick.seal', gimmick.gimmick?.label ?? 'none');
check('처음에는 미파악', gimmick.gimmick?.identified === false);

// 판정 보정이 관찰력 · 운 · 성좌 관측에서 나오는지
const insightPlan = planCheck(
  'INSIGHT',
  gimmick.gimmick!,
  gimmick.pairs[2].hunter.stats,
  gimmick.pairs[2].constellation.stats,
);
check('파악 보정 = 관찰력 + 관측/2', insightPlan.bonus > 0, `+${insightPlan.bonus} (${insightPlan.breakdown.join(' / ')})`);
check('파악 목표치', insightPlan.dc === 12, `DC ${insightPlan.dc}`);

const resolvePlan = planCheck(
  'RESOLVE',
  gimmick.gimmick!,
  gimmick.pairs[0].hunter.stats,
  gimmick.pairs[0].constellation.stats,
);
check('해결 보정 = 운 + 관찰력/2', resolvePlan.bonus > 0, `+${resolvePlan.bonus} (${resolvePlan.breakdown.join(' / ')})`);

// 선언 없이 시도하면 진행되지 않는다
gimmick = submitPairAction(gimmick, gimmick.pairs[0].id, {
  hunterActionId: 'hunter.gimmick',
  constellationActionId: 'const.wait',
  hunterSubmitted: true,
  constellationSubmitted: true,
});
check('선언 없는 기믹은 진행 0', previewRound(gimmick).pairs[0].gimmickProgress === 0);
check('선언 검증', declarationValid('짧다') === false && declarationValid('문양의 홈을 훑는다') === true);

// 파악 성공
const insightCheck = {
  stage: 'INSIGHT' as const,
  expression: '1d20',
  rolls: [18],
  bonus: insightPlan.bonus,
  breakdown: insightPlan.breakdown,
  total: 18 + insightPlan.bonus,
  dc: insightPlan.dc,
  success: true,
  critical: false,
};
gimmick = submitPairAction(gimmick, gimmick.pairs[0].id, {
  gimmickNote: '문양의 홈을 따라 반복되는 배열을 찾는다',
  gimmickStage: 'INSIGHT',
  gimmickCheck: insightCheck,
});
const insightPreview = previewRound(gimmick);
check('파악 판정 성립', insightPreview.pairs[0].gimmickIdentified === true);
check('파악은 진행량을 주지 않음', insightPreview.pairs[0].gimmickProgress === 0);
gimmick = applyRound(gimmick, insightPreview);
check('파악 결과가 공유됨', gimmick.gimmick?.identified === true, gimmick.gimmick?.identifiedBy.join(','));
check('파악 경보', gimmick.alerts.some((a) => a.title === 'GIMMICK IDENTIFIED'));

// 해결 — 3회 필요하므로 페어 3조가 성공시킨다
for (const pair of gimmick.pairs.slice(0, 3)) {
  const plan = planCheck('RESOLVE', gimmick.gimmick!, pair.hunter.stats, pair.constellation.stats);
  gimmick = submitPairAction(gimmick, pair.id, {
    hunterActionId: 'hunter.gimmick',
    constellationActionId: 'const.wait',
    gimmickNote: '파악한 순서대로 고정점을 끊어낸다',
    gimmickStage: 'RESOLVE',
    gimmickCheck: {
      stage: 'RESOLVE',
      expression: '1d20',
      rolls: [15],
      bonus: plan.bonus,
      breakdown: plan.breakdown,
      total: 15 + plan.bonus,
      dc: plan.dc,
      success: true,
      critical: false,
    },
    hunterSubmitted: true,
    constellationSubmitted: true,
  });
}
const resolvePreview = previewRound(gimmick);
check('해결 성공 시 진행량', resolvePreview.gimmick?.willClear === true, `${resolvePreview.gimmick?.progress}/${resolvePreview.gimmick?.required}`);
gimmick = applyRound(gimmick, resolvePreview);
check('기믹 해제', gimmick.gimmick?.status === 'CLEARED', gimmick.gimmick?.status ?? '');
check(
  '해제 효과로 적 상태이상',
  gimmick.enemies[0].statuses.some((s) => s.defId === 'def.down.great'),
  gimmick.enemies[0].statuses.map((s) => s.defId).join(','),
);
check('기믹 경보', gimmick.alerts.some((a) => a.title === 'GIMMICK CLEARED'));

/* ── 8-1. 기믹 접근 — 무엇을 해야 풀리는가 ─────────── */
console.log('\n=== 8-1. 기믹 접근 ===');

const approachBattle = createBattle({ mode: 'RAID', pairCount: 2 });
const approachPair = approachBattle.pairs[0];
const planWith = (stage: 'INSIGHT' | 'RESOLVE', note: string | null) =>
  planCheck(
    stage,
    approachBattle.gimmick!,
    approachPair.hunter.stats,
    approachPair.constellation.stats,
    note,
  );

const bare = planWith('INSIGHT', null);
check('선언 전에는 접근 보정이 없다', bare.matched === null && bare.offApproach === false);
check('인정되는 접근이 정의되어 있다', bare.approaches.length > 0, `${bare.approaches.length}가지`);
check(
  '접근 목록은 해당 단계만 담는다',
  bare.approaches.every((row) => row.stage === 'INSIGHT'),
);

const matchedInsight = planWith('INSIGHT', '문양의 홈을 따라 반복되는 배열을 찾는다');
check(
  '맞는 접근이면 보정이 붙는다',
  matchedInsight.matched?.id === 'seal.insight.trace' &&
    matchedInsight.bonus === bare.bonus + matchedInsight.matched.bonus,
  `+${matchedInsight.bonus} (${matchedInsight.matched?.label ?? 'none'})`,
);

const offInsight = planWith('INSIGHT', '일단 힘껏 걷어차 본다');
check('엉뚱한 접근은 감점', offInsight.offApproach === true && offInsight.bonus < bare.bonus, `+${offInsight.bonus}`);
check('감점 폭은 규칙값 그대로', offInsight.bonus === bare.bonus + GIMMICK_CHECK.offApproachPenalty);

const matchedResolve = planWith('RESOLVE', '파악한 순서대로 고정점을 끊어낸다');
check('해결 접근도 인정된다', matchedResolve.matched?.id === 'seal.resolve.cut');
check(
  '해결 단계에서 파악용 접근은 걸리지 않는다',
  planWith('RESOLVE', '두드려서 울림을 듣는다').matched === null,
);

const approachRoll = rollCheck(matchedResolve);
check(
  '판정 기록에 인정된 접근이 남는다',
  approachRoll?.approachId === 'seal.resolve.cut',
  approachRoll?.approachLabel ?? 'none',
);

/* ── 8-2. 기믹 없는 전투 ────────────────────────────── */
console.log('\n=== 8-2. 기믹 없는 보스 ===');

const noGimmick = createBattle({ mode: 'DUEL', pairCount: 1, gimmickId: null });
check('기믹 없이 전투가 만들어진다', noGimmick.gimmick === null);

const gimmickAction = findAction('hunter.gimmick')!;
check(
  '기믹이 없으면 기믹 수행이 잠긴다',
  actionAvailability(gimmickAction, noGimmick.pairs[0], true, noGimmick.gimmick).usable === false,
  actionAvailability(gimmickAction, noGimmick.pairs[0], true, noGimmick.gimmick).reason ?? '',
);
check(
  '기믹을 넘기지 않으면 확인하지 않는다',
  actionAvailability(gimmickAction, noGimmick.pairs[0], true).usable === true,
);
check(
  '해제된 기믹에는 다시 시도할 수 없다',
  actionAvailability(gimmickAction, gimmick.pairs[0], true, gimmick.gimmick).usable === false,
);

const wardenSet = findPatternSet('set.warden');
check('기믹 없는 보스 패턴 세트가 있다', wardenSet !== null && wardenSet.requiresGimmick === false);
check('그 세트도 3페이즈를 가진다', (wardenSet?.phaseThresholds.length ?? 0) === 3);
check(
  '세트의 모든 트리거가 실재하는 패턴을 가리킨다',
  PATTERN_SETS.every((set) =>
    [...set.triggers.map((t) => t.patternId), set.fallbackPatternId].every((id) =>
      Boolean(findPattern(id)),
    ),
  ),
);
check(
  '예고 패턴은 발동 패턴으로 이어진다',
  PATTERN_DEFINITIONS.filter((row) => row.shape === 'TELEGRAPH').every((row) =>
    Boolean(findPattern(row.resolvesTo ?? null)),
  ),
);

// 기믹 없는 전투에서도 라운드가 끝까지 돈다
let wardenBattle = submitPairAction(noGimmick, noGimmick.pairs[0].id, {
  hunterActionId: 'hunter.attack',
  constellationActionId: 'const.buff',
  hunterSubmitted: true,
  constellationSubmitted: true,
});
wardenBattle = applyRound(wardenBattle, previewRound(wardenBattle));
check('기믹 없이도 라운드가 진행된다', wardenBattle.round === 2 && wardenBattle.gimmick === null);

// 다이스
console.log('\n=== 8-3. 다이스 ===');
check('표기 해석', JSON.stringify(parseDice('2d6+3')) === '{"count":2,"sides":6,"modifier":3}');
check('생략 표기', parseDice('d20')?.count === 1);
check('잘못된 표기 거부', parseDice('2x6') === null && parseDice('99d6') === null);
const rolled = rollDice('3d6+2');
check(
  '굴림 범위',
  rolled !== null && rolled.rolls.length === 3 && rolled.rolls.every((v) => v >= 1 && v <= 6),
  rolled ? formatDice(rolled) : 'null',
);
check('합계 = 눈 + 보정', rolled !== null && rolled.total === rolled.rolls.reduce((a, b) => a + b, 0) + 2);

/* ── 9. 현신 ────────────────────────────────────────── */
console.log('\n=== 9. 현신 ===');
let manifest = createBattle({ mode: 'DUEL', primaryPair: { hunterSheet, constellationSheet }, gimmickId: null });
manifest = submitPairAction(manifest, manifest.pairs[0].id, {
  hunterActionId: 'hunter.attack',
  constellationActionId: 'const.manifest',
  hunterSubmitted: true,
  constellationSubmitted: true,
});
const manifestPreview = previewRound(manifest);
check('현신 피해 합산', manifestPreview.pairs[0].damageToEnemy > 0);
manifest = applyRound(manifest, manifestPreview);
check(
  '부분 현신 횟수 차감',
  manifest.pairs[0].constellation.manifestUses.partial === 1,
  String(manifest.pairs[0].constellation.manifestUses.partial),
);
check('현신 경보', manifest.alerts.some((a) => a.title === 'MANIFESTATION DETECTED'));

/* ── 10. 보스 페이즈 · 패턴 ─────────────────────────── */
console.log('\n=== 10. 보스 페이즈 · 패턴 ===');
let boss = createBattle({ mode: 'RAID', pairCount: 3, gimmickId: null });
const bossEnemy = { ...boss.enemies[0], hp: Math.round(boss.enemies[0].maxHp * 0.5) };
check('HP 50% → PHASE 2', evaluatePhase(bossEnemy).phase === 2, `phase ${evaluatePhase(bossEnemy).phase}`);
check('페이즈 변경 감지', evaluatePhase(bossEnemy).changed === true);

boss = { ...boss, enemies: [{ ...bossEnemy, phase: 2 }] };
const telegraphPattern = selectPattern(boss.enemies[0], 1);
check('PHASE 2 라운드 1 → 광역 예고', telegraphPattern?.id === 'pattern.sweep.warning', telegraphPattern?.label ?? 'none');

for (const pair of boss.pairs) {
  boss = submitPairAction(boss, pair.id, {
    hunterActionId: 'hunter.attack',
    constellationActionId: 'const.wait',
    hunterSubmitted: true,
  constellationSubmitted: true,
  });
}
const bossPreview = previewRound(boss);
check('예고 라운드는 피해 없음', bossPreview.enemies[0].damageToHunter === 0);
check('예고 정보 생성', Boolean(bossPreview.enemies[0].telegraph));
check('예고 경보', bossPreview.alerts.some((a) => a.level === 'TOWER'));

boss = applyRound(boss, bossPreview);
check('예고 상태 저장', Boolean(boss.enemies[0].telegraph));

// 페이즈 경계를 넘는 순간 경보가 뜨는지 별도로 확인한다
let phaseShift = createBattle({ mode: 'RAID', pairCount: 2, gimmickId: null });
phaseShift = {
  ...phaseShift,
  enemies: [{ ...phaseShift.enemies[0], hp: Math.round(phaseShift.enemies[0].maxHp * 0.5), phase: 1 }],
};
for (const pair of phaseShift.pairs) {
  phaseShift = submitPairAction(phaseShift, pair.id, {
    hunterActionId: 'hunter.attack',
    constellationActionId: 'const.wait',
    hunterSubmitted: true,
  constellationSubmitted: true,
  });
}
phaseShift = applyRound(phaseShift, previewRound(phaseShift));
check('페이즈 자동 변경', phaseShift.enemies[0].phase === 2, `phase ${phaseShift.enemies[0].phase}`);
check('페이즈 변경 경보', phaseShift.alerts.some((a) => a.title === 'BOSS PHASE CHANGE'));

for (const pair of boss.pairs) {
  boss = submitPairAction(boss, pair.id, {
    hunterActionId: 'hunter.attack',
    constellationActionId: 'const.wait',
    hunterSubmitted: true,
  constellationSubmitted: true,
  });
}
const aoePreview = previewRound(boss);
check('예고 해소 → 광역 공격', aoePreview.enemies[0].aoe === true, aoePreview.enemies[0].pattern);
check(
  '광역은 모든 생존 페어 타격',
  aoePreview.enemies[0].hits.length === boss.pairs.filter((p) => p.hunter.hp > 0).length,
  `${aoePreview.enemies[0].hits.length}페어`,
);
check(
  '광역 상태이상 부여',
  aoePreview.enemies[0].appliedStatuses.some((s) => s.defId === 'burn'),
);

/* ── 10-2. 커스텀 공격 패턴 ─────────────────────────── */
console.log('\n=== 10-2. 커스텀 공격 패턴 ===');

function attack(over: Partial<CustomAttack>): CustomAttack {
  return {
    id: over.id ?? 'A',
    name: over.name ?? '공격',
    description: '',
    powerRatio: 1,
    aoe: false,
    applyStatusIds: [],
    selfStatusIds: [],
    revealed: true,
    telegraphRounds: 0,
    telegraphMessage: '',
    phases: [],
    ...over,
  };
}

let custom = createBattle({ mode: 'RAID', pairCount: 2, gimmickId: null });
const customEnemy = {
  ...custom.enemies[0],
  patternSetId: null,
  maxPhase: 2,
  phase: 1,
  attacks: [
    attack({ id: 'p1a', name: '일격', phases: [1] }),
    attack({ id: 'p1b', name: '연격', phases: [1] }),
    attack({
      id: 'p2',
      name: '포식',
      phases: [2],
      aoe: true,
      powerRatio: 2,
      telegraphRounds: 1,
      telegraphMessage: '탑이 울린다',
      applyStatusIds: ['burn'],
    }),
  ],
};

check('1페이즈 라운드 1 → 첫 공격', selectPattern(customEnemy, 1)?.label === '일격');
check('라운드가 지나면 다음 공격', selectPattern(customEnemy, 2)?.label === '연격');
check('목록을 한 바퀴 돌면 처음으로', selectPattern(customEnemy, 3)?.label === '일격');
check(
  '다른 페이즈 공격은 섞이지 않음',
  [1, 2, 3, 4].every((round) => selectPattern(customEnemy, round)?.label !== '포식'),
);

const phase2Enemy = { ...customEnemy, phase: 2 };
const warn = selectPattern(phase2Enemy, 1);
check('2페이즈 → 예고 패턴', warn?.shape === 'TELEGRAPH', warn?.label ?? 'none');
check('예고 문구 전달', warn?.telegraphMessage === '탑이 울린다');

const resolved = selectPattern(
  { ...phase2Enemy, telegraph: { patternId: warn!.id, label: warn!.label, message: '', roundsLeft: 0 } },
  2,
);
check('예고가 끝나면 본 공격 발동', resolved?.label === '포식', resolved?.label ?? 'none');
check('광역 · 계수 유지', resolved?.shape === 'AOE' && resolved?.powerRatio === 2);

check(
  '패턴 세트가 없으면 HP 로 페이즈를 나눈다',
  evaluatePhase({ ...customEnemy, hp: Math.round(customEnemy.maxHp * 0.4) }).phase === 2,
  `phase ${evaluatePhase({ ...customEnemy, hp: Math.round(customEnemy.maxHp * 0.4) }).phase}`,
);
check('가득 찬 HP 는 1페이즈', evaluatePhase({ ...customEnemy, hp: customEnemy.maxHp }).phase === 1);

// 실제 라운드 처리까지 통과하는지 확인한다
custom = { ...custom, enemies: [customEnemy] };
for (const pair of custom.pairs) {
  custom = submitPairAction(custom, pair.id, {
    hunterActionId: 'hunter.attack',
    constellationActionId: 'const.wait',
    hunterSubmitted: true,
    constellationSubmitted: true,
  });
}
const customPreview = previewRound(custom);
check('커스텀 공격으로 피해 발생', customPreview.enemies[0].damageToHunter > 0, `${customPreview.enemies[0].damageToHunter}`);
check('커스텀 공격 이름이 그대로 표기', customPreview.enemies[0].pattern === '일격');
check('빈 페이즈는 아무 공격도 하지 않음', selectPattern({ ...customEnemy, phase: 5 }, 1) === null);

/* ── 10-3. 보스 패턴 설정 ───────────────────────────── */
console.log('\n=== 10-3. 보스 패턴 설정 ===');

// 주기 조건 — 3라운드마다 1번 자리 (1 · 4 · 7 라운드)
const cycled = {
  ...customEnemy,
  maxPhase: 1,
  phase: 1,
  attacks: [
    attack({ id: 'c1', name: '포효', every: 3, offset: 1 }),
    attack({ id: 'c2', name: '평타' }),
  ],
};
check('주기 조건이 맞는 라운드 → 조건 공격', selectPattern(cycled, 1)?.label === '포효');
check(
  '조건 밖 라운드 → 조건 없는 공격',
  [2, 3].every((round) => selectPattern(cycled, round)?.label === '평타'),
);
check('주기가 한 바퀴 돌면 다시 발동', selectPattern(cycled, 4)?.label === '포효');

// 조건이 겹치면 목록에서 위에 있는 쪽이 이긴다
const contested = {
  ...cycled,
  attacks: [
    attack({ id: 'c3', name: '위', every: 2, offset: 0 }),
    attack({ id: 'c4', name: '아래', every: 2, offset: 0 }),
    attack({ id: 'c5', name: '평타' }),
  ],
};
check('조건이 겹치면 위에 있는 공격', selectPattern(contested, 2)?.label === '위');

// HP 조건
const desperate = {
  ...cycled,
  attacks: [
    attack({ id: 'h1', name: '발악', hpBelowPercent: 30 }),
    attack({ id: 'h2', name: '평타' }),
  ],
};
check(
  'HP 조건을 못 채우면 쓰지 않는다',
  selectPattern({ ...desperate, hp: desperate.maxHp }, 1)?.label === '평타',
);
check(
  'HP 조건을 채우면 그 공격을 쓴다',
  selectPattern({ ...desperate, hp: Math.round(desperate.maxHp * 0.2) }, 1)?.label === '발악',
);
check(
  '조건 공격만 있으면 조건 밖 라운드에는 아무것도 하지 않는다',
  selectPattern(
    { ...desperate, hp: desperate.maxHp, attacks: [desperate.attacks[0]] },
    1,
  ) === null,
);

// 페이즈 경계
const banded = { ...customEnemy, maxPhase: 3, phaseCutoffs: [80, 50] };
check(
  '경계를 직접 정하면 그 값으로 페이즈를 판정한다',
  [
    evaluatePhase({ ...banded, hp: Math.round(banded.maxHp * 0.85) }).phase === 1,
    evaluatePhase({ ...banded, hp: Math.round(banded.maxHp * 0.6) }).phase === 2,
    evaluatePhase({ ...banded, hp: Math.round(banded.maxHp * 0.4) }).phase === 3,
  ].every(Boolean),
);
check(
  '경계 값에 정확히 걸리면 아직 위 페이즈',
  evaluatePhase({ ...banded, hp: banded.maxHp * 0.8 }).phase === 1,
);
check(
  '경계 아래로 떨어지면 다음 페이즈',
  evaluatePhase({ ...banded, hp: banded.maxHp * 0.799 }).phase === 2,
);
check(
  '경계는 내림차순으로 정리된다',
  JSON.stringify(normalizeCutoffs([30, 70], 3)) === '[70,30]',
  JSON.stringify(normalizeCutoffs([30, 70], 3)),
);
check(
  '부족한 경계는 남은 구간을 균등하게 나눈다',
  JSON.stringify(normalizeCutoffs([60], 3)) === '[60,30]',
  JSON.stringify(normalizeCutoffs([60], 3)),
);
check('페이즈가 하나면 경계가 없다', normalizeCutoffs([50], 1).length === 0);
check(
  '경계를 비우면 페이즈 수만큼 균등 분할',
  phaseBands({ maxPhase: 2 }).map((band) => band.minPercent).join(',') === '50,0',
);
check(
  '경계를 비우면 프리셋 세트를 따른다',
  phaseBands({ maxPhase: 3, patternSetId: 'set.star_devourer' })[0].minPercent === 71,
);

// 프리셋 → 커스텀 펼치기
const imported = patternSetToPreset('set.star_devourer');
check('프리셋을 공격 목록으로 펼친다', (imported?.attacks.length ?? 0) > 0, `${imported?.attacks.length}개`);
check('펼친 결과가 3페이즈', imported?.maxPhase === 3 && imported?.phaseCutoffs.length === 2);
check(
  '예고와 본체가 한 공격으로 합쳐진다',
  imported!.attacks.some((row) => row.telegraphRounds > 0 && row.powerRatio > 0 && row.telegraphMessage !== ''),
);
check(
  '트리거 조건이 그대로 넘어온다',
  imported!.attacks.some((row) => (row.every ?? 0) >= 2 && row.phases.length > 0),
);
check(
  '조건 없는 기본 공격이 하나 남는다',
  imported!.attacks.some((row) => (row.every ?? 0) < 2 && row.hpBelowPercent == null && row.phases.length === 0),
);
check(
  '펼친 패턴은 모든 페이즈에서 무언가를 한다',
  [1, 2, 3].every((phase) =>
    [1, 2, 3, 4].some((round) =>
      selectPattern(
        {
          ...customEnemy,
          patternSetId: null,
          maxPhase: 3,
          phase,
          phaseCutoffs: imported!.phaseCutoffs,
          attacks: imported!.attacks,
          telegraph: null,
        },
        round,
      ) !== null,
    ),
  ),
);

// 진행표
const schedule = patternSchedule(
  { maxPhase: 3, phaseCutoffs: imported!.phaseCutoffs, attacks: imported!.attacks, maxHp: 1000 },
  6,
);
check('진행표는 페이즈마다 한 줄', schedule.length === 3);
check('진행표 한 줄에 요청한 라운드 수', schedule[0].rounds.length === 6);
check(
  '진행표는 구간 가운데 HP 를 기준으로 본다',
  schedule[2].samplePercent < schedule[0].samplePercent,
  `${schedule[2].samplePercent}% vs ${schedule[0].samplePercent}%`,
);

// 전투 중 페이즈 규칙 변경
let ruled = createBattle({ mode: 'DUEL', gimmickId: null });
ruled = { ...ruled, enemies: [{ ...ruled.enemies[0], maxPhase: 3, phase: 3 }] };
ruled = admin.setEnemyPhaseRules(ruled, ruled.enemies[0].id, { phaseCutoffs: [90, 60] });
check('전투 중 경계 변경', JSON.stringify(ruled.enemies[0].phaseCutoffs) === '[90,60]');
ruled = admin.setEnemyPhaseRules(ruled, ruled.enemies[0].id, { maxPhase: 2 });
check(
  '페이즈 수를 줄이면 현재 페이즈도 내려온다',
  ruled.enemies[0].phase === 2 && ruled.enemies[0].phaseCutoffs?.length === 1,
  `phase ${ruled.enemies[0].phase} · ${JSON.stringify(ruled.enemies[0].phaseCutoffs)}`,
);
check('변경이 로그에 남는다', ruled.log.some((row) => row.text.includes('페이즈 규칙 변경')));

/* ── 11. 자동 행동 · 레이드 ─────────────────────────── */
console.log('\n=== 11. 자동 행동 · 레이드 ===');
let solo = createBattle({ mode: 'DUEL', gimmickId: null });
solo = setControlMode(solo, solo.pairs[0].id, 'CONSTELLATION', 'AUTO');
solo = submitPairAction(solo, solo.pairs[0].id, { hunterActionId: 'hunter.attack', hunterSubmitted: true, constellationSubmitted: true });
const soloRow = previewRound(solo).pairs[0];
check('성좌만 자동 위임', soloRow.autoFilled.length === 1 && soloRow.autoFilled[0] === 'CONSTELLATION');
check('현신을 자동으로 고르지 않음', soloRow.constellationActionId !== 'const.manifest.full');
check(
  '미제출이면 양쪽 모두 자동',
  previewRound(createBattle({ mode: 'DUEL', gimmickId: null })).pairs[0].autoFilled.length === 2,
);

let raid = createBattle({ mode: 'RAID', pairCount: 4, monsterCount: 1, gimmickId: null });
check('레이드 4페어 / 적 2체', raid.pairs.length === 4 && raid.enemies.length === 2);
const raidPreview = previewRound(raid);
const lowRow = raidPreview.pairs.find((r) => r.pairId === raid.pairs[3].id)!;
check('HP 40% 미만 → 자동 방어', lowRow.hunterActionId === 'hunter.defend', String(lowRow.hunterActionId));
check('프리셋 스킬 보유', raid.pairs[0].hunter.skills.length > 0, `${raid.pairs[0].hunter.skills.length}개`);
raid = applyRound(raid, raidPreview);
check('레이드 라운드 진행', raid.round === 2);

/* ── 12. 종료 판정 ──────────────────────────────────── */
console.log('\n=== 12. 종료 판정 ===');
let ending: BattleState = createBattle({ mode: 'DUEL', gimmickId: null });
ending = { ...ending, enemies: [{ ...ending.enemies[0], hp: 3 }] };
ending = submitPairAction(ending, ending.pairs[0].id, {
  hunterActionId: 'hunter.attack',
  constellationActionId: 'const.buff',
  hunterSubmitted: true,
  constellationSubmitted: true,
});
ending = applyRound(ending, previewRound(ending));
check('적 처치 → CLEARED', ending.status === 'CLEARED', ending.status);

let wipe: BattleState = createBattle({ mode: 'DUEL', gimmickId: null });
wipe = { ...wipe, pairs: [{ ...wipe.pairs[0], hunter: { ...wipe.pairs[0].hunter, hp: 1 } }] };
wipe = applyRound(wipe, previewRound(wipe));
check('헌터 전멸 → FAILED', wipe.status === 'FAILED', wipe.status);
check('부상 단계 DOWN', injuryOf(wipe.pairs[0].hunter).stage === 'DOWN');
check('viewerPair 조회', viewerPair(raid).id === raid.viewerPairId);
check(
  '프리셋도 시트 파생 경로 통과',
  raid.pairs[0].hunter.attack === deriveHunter(presetSheet(pairPreset(0).hunter, 'HUNTER', 'GOVERNMENT', 0)).attack,
);


/* ── 13. 클래스 · 권역 특성 ─────────────────────────── */
console.log('\n=== 13. 클래스 · 권역 특성 ===');

const guardianHunter = hunterStateFromSheet(hunterSheet); // guardian
const rangerHunter = hunterStateFromSheet({ ...hunterSheet, id: 'T-R', classId: 'ranger' });
const casterHunter = hunterStateFromSheet({ ...hunterSheet, id: 'T-C', classId: 'caster' });
const medicHunter = hunterStateFromSheet({ ...hunterSheet, id: 'T-M', classId: 'medic' });
const calamityConst = constellationStateFromSheet(constellationSheet); // calamity
const graceConst = constellationStateFromSheet({ ...constellationSheet, id: 'T-G', classId: 'grace' });
const guardConst = constellationStateFromSheet({ ...constellationSheet, id: 'T-GD', classId: 'guard' });
const omenConst = constellationStateFromSheet({ ...constellationSheet, id: 'T-O', classId: 'omen' });

check(
  '방어 전담형 — 보호 효과 강화',
  protectAmplifier(guardianHunter, calamityConst, true) === 1.6,
  String(protectAmplifier(guardianHunter, calamityConst, true)),
);
check(
  '수호 권역 — 피해 감소 부여 강화',
  protectAmplifier(guardianHunter, guardConst, false) === 1.7,
  String(protectAmplifier(guardianHunter, guardConst, false)),
);
check('원거리 사격형 — 약점 공격 판정', weakPointBonus(rangerHunter, true) === 0.25);
check('약점이 없으면 보정 없음', weakPointBonus(rangerHunter, false) === 0);
check('다른 클래스는 약점 보정 없음', weakPointBonus(guardianHunter, true) === 0);
check('권능 술사형 — 받는 버프 증폭', buffAmplifier(casterHunter) === 1.25);
check('일반 클래스는 증폭 없음', buffAmplifier(guardianHunter) === 1);
check(
  '구조 지원형 + 은총 권역 — 구조 보정 합산',
  Math.abs(rescueBonus(medicHunter, graceConst) - 0.8) < 1e-9,
  String(rescueBonus(medicHunter, graceConst)),
);
check(
  '치료 보정 합산',
  Math.abs(healBonus(medicHunter, graceConst) - 0.7) < 1e-9,
  String(healBonus(medicHunter, graceConst)),
);
check('재앙 권역 — 상태이상 지속 연장', statusDurationBonus(calamityConst) === 1);
check('예지 권역 — 계시 공유', revelationShared(omenConst) === true);
check('다른 권역은 계시 공유 없음', revelationShared(calamityConst) === false);
check(
  '현신 스탯 — 현신 위력',
  Math.abs(manifestPower(calamityConst) - 1.24) < 1e-9,
  String(manifestPower(calamityConst)),
);
check(
  '현신 스탯 — 반동 경감',
  Math.abs(recoilRelief(calamityConst) - 0.24) < 1e-9,
  String(recoilRelief(calamityConst)),
);
check('공명 스탯 — 계약 회복량', contractRecovery(calamityConst) === 1.5);
check(
  '미반영 표시가 남아 있지 않다',
  [...HUNTER_CLASSES, ...CONSTELLATION_CLASSES].every((row) => !row.pending),
  [...HUNTER_CLASSES, ...CONSTELLATION_CLASSES]
    .filter((row) => row.pending)
    .map((row) => row.label)
    .join(','),
);
check(
  '모든 스탯이 계산에 반영된다',
  [...HUNTER_STATS, ...CONSTELLATION_STATS].every((row) => row.activeFrom <= CURRENT_PHASE),
  [...HUNTER_STATS, ...CONSTELLATION_STATS]
    .filter((row) => row.activeFrom > CURRENT_PHASE)
    .map((row) => row.label)
    .join(','),
);
check(
  '모든 행동이 사용 가능 단계에 들어왔다',
  ALL_ACTIONS.every((row) => row.implementedIn <= CURRENT_PHASE),
  ALL_ACTIONS.filter((row) => row.implementedIn > CURRENT_PHASE).map((row) => row.id).join(','),
);
check(
  '모든 스킬 종류가 계산에 반영된다',
  SKILL_KINDS.every((row) => row.activeFrom <= CURRENT_PHASE),
  SKILL_KINDS.filter((row) => row.activeFrom > CURRENT_PHASE).map((row) => row.kind).join(','),
);

// 보호 행동이 실제로 강화된 배율로 걸리는지
let protect = createBattle({ mode: 'RAID', pairCount: 2, gimmickId: null });
protect = submitPairAction(protect, protect.pairs[1].id, {
  hunterActionId: 'hunter.protect',
  constellationActionId: 'const.wait',
  supportTargetPairId: protect.pairs[1].id,
  hunterSubmitted: true,
  constellationSubmitted: true,
});
const protectRow = previewRound(protect).pairs[1];
const guardApplication = protectRow.appliedStatuses.find((row) => row.defId === 'guard.up');
check(
  '보호 행동이 강화 배율로 걸린다 (PAIR 02 = 방어 전담형 · 재앙 권역)',
  guardApplication !== undefined && guardApplication.scale === 1.6,
  `scale ${guardApplication?.scale}`,
);

// 약점이 드러난 적을 노릴 때 사격형만 보정을 받는다
function weakPointNotes(classId: string): string[] {
  let state = createBattle({
    mode: 'DUEL',
    primaryPair: { hunterSheet: { ...hunterSheet, id: `T-WP-${classId}`, classId }, constellationSheet },
    gimmickId: null,
  });
  state = {
    ...state,
    enemies: [{ ...state.enemies[0], statuses: applyStatus([], 'weak', 'TEST') }],
  };
  state = submitPairAction(state, state.pairs[0].id, {
    hunterActionId: 'hunter.attack',
    constellationActionId: 'const.wait',
    hunterSubmitted: true,
    constellationSubmitted: true,
  });
  return previewRound(state).pairs[0].notes;
}
check(
  '약점 공격 보정이 사격형에게만 붙는다',
  weakPointNotes('ranger').some((line) => line.includes('약점 공격 보정')) &&
    !weakPointNotes('guardian').some((line) => line.includes('약점 공격 보정')),
);

/* ── 14. 의지 — 상태이상 저항 · 전투 불능 저항 ──────── */
console.log('\n=== 14. 의지 저항 ===');

check('지속시간 단축이 반영된다', applyStatus([], 'burn', 'T', 1, -1)[0].remainingRounds === 2);
check('지속시간은 최소 1 라운드 남는다', applyStatus([], 'bind', 'T', 1, -5)[0].remainingRounds === 1);
check('연장도 반영된다', applyStatus([], 'def.down', 'T', 1, 2)[0].remainingRounds === 4);
check('의지 3 → 1 라운드 저항', statusResistRounds(guardianHunter) === 1);
check('의지가 낮으면 저항 없음', statusResistRounds(hunterStateFromSheet({ ...hunterSheet, id: 'T-W0', stats: { ...hunterSheet.stats, wil: 1 } })) === 0);

const willSheet: CharacterSheet = {
  ...hunterSheet,
  id: 'TEST-WILL',
  stats: { str: 2, vit: 6, agi: 4, sen: 1, wil: 4 },
};
check('의지 4 → 전투 불능 저항 가능', canLastStand(hunterStateFromSheet(willSheet)) === true);
check('의지 3 → 전투 불능 저항 불가', canLastStand(guardianHunter) === false);

let lastStand = createBattle({
  mode: 'DUEL',
  primaryPair: { hunterSheet: willSheet, constellationSheet },
  gimmickId: null,
});
lastStand = {
  ...lastStand,
  pairs: [{ ...lastStand.pairs[0], hunter: { ...lastStand.pairs[0].hunter, hp: 1 } }],
};
lastStand = submitPairAction(lastStand, lastStand.pairs[0].id, {
  hunterActionId: 'hunter.attack',
  constellationActionId: 'const.wait',
  hunterSubmitted: true,
  constellationSubmitted: true,
});
lastStand = applyRound(lastStand, previewRound(lastStand));
check('전투 불능 직전에 버텨낸다', lastStand.pairs[0].hunter.hp === 1, `HP ${lastStand.pairs[0].hunter.hp}`);
check('저항을 소진했다고 기록된다', lastStand.pairs[0].hunter.lastStandUsed === true);
check('버팀 경보', lastStand.alerts.some((a) => a.title === 'HUNTER HELD ON'));
check('전멸로 끝나지 않는다', lastStand.status === 'ENGAGED', lastStand.status);

// 두 번째로 쓰러질 때는 버티지 못한다
lastStand = {
  ...lastStand,
  pairs: [{ ...lastStand.pairs[0], hunter: { ...lastStand.pairs[0].hunter, hp: 1 } }],
};
lastStand = submitPairAction(lastStand, lastStand.pairs[0].id, {
  hunterActionId: 'hunter.attack',
  constellationActionId: 'const.wait',
  hunterSubmitted: true,
  constellationSubmitted: true,
});
lastStand = applyRound(lastStand, previewRound(lastStand));
check('저항은 전투당 한 번뿐', lastStand.status === 'FAILED', lastStand.status);

/* ── 15. 계약 안정도 ────────────────────────────────── */
console.log('\n=== 15. 계약 안정도 ===');

check('값에서 단계를 끌어낸다', contractStageOf(88) === 'RESONANCE');
check('경계값 판정', contractStageOf(70) === 'HEIGHTENED' && contractStageOf(69) === 'CALM');
check('바닥 판정', contractStageOf(0) === 'BROKEN');
check('값을 범위 안으로 자른다', contractFromValue(140).value === 100 && contractFromValue(-5).value === 0);
check('계약 단계가 권능에 곱해진다', contractPowerMultiplier('RESONANCE') === 1.1);
check('붕괴한 계약으로는 현신 불가', canManifest('STABLE', 'BROKEN') === false);
check('정상 계약이면 현신 가능', canManifest('STABLE', 'RESONANCE') === true);
check('성좌 상태 단계 이동', shiftStage('CRACKED', 1) === 'COLLAPSE' && shiftStage('CRACKED', -1) === 'UNSTABLE');
check('단계 이동은 범위를 넘지 않는다', shiftStage('STABLE', -3) === 'STABLE' && shiftStage('LOST', 2) === 'LOST');

const resonantSheet: CharacterSheet = {
  ...constellationSheet,
  id: 'TEST-RES',
  stats: { authority: 6, divinity: 3, resonance: 5, observation: 4, manifest: 3 },
};
let contract = createBattle({
  mode: 'DUEL',
  primaryPair: { hunterSheet, constellationSheet: resonantSheet },
  gimmickId: null,
});
check('전투 시작 계약 안정도', contract.pairs[0].contract.value === CONTRACT_RULES.initialValue);
contract = submitPairAction(contract, contract.pairs[0].id, {
  hunterActionId: 'hunter.attack',
  constellationActionId: 'const.wait',
  hunterSubmitted: true,
  constellationSubmitted: true,
});
const contractPreview = previewRound(contract);
check(
  '공명이 계약을 회복시킨다',
  contractPreview.pairs[0].contractDelta === 9,
  `delta ${contractPreview.pairs[0].contractDelta}`,
);
contract = applyRound(contract, contractPreview);
check('회복이 상태에 반영된다', contract.pairs[0].contract.value === 97, `value ${contract.pairs[0].contract.value}`);

// 현신 반동 — 계약이 깎인다
let recoil = createBattle({
  mode: 'DUEL',
  primaryPair: { hunterSheet, constellationSheet },
  gimmickId: null,
});
recoil = submitPairAction(recoil, recoil.pairs[0].id, {
  hunterActionId: 'hunter.attack',
  constellationActionId: 'const.manifest.full',
  hunterSubmitted: true,
  constellationSubmitted: true,
});
const recoilPreview = previewRound(recoil);
check(
  '완전 현신은 계약에 반동을 남긴다',
  recoilPreview.pairs[0].contractDelta < 0,
  `delta ${recoilPreview.pairs[0].contractDelta}`,
);
recoil = applyRound(recoil, recoilPreview);
check(
  '반동이 계약 값을 깎는다',
  recoil.pairs[0].contract.value < CONTRACT_RULES.initialValue,
  `value ${recoil.pairs[0].contract.value}`,
);

// 현신 스탯이 위력에 개입한다
function manifestDamage(manifestStat: number): number {
  let state = createBattle({
    mode: 'DUEL',
    primaryPair: {
      hunterSheet,
      constellationSheet: {
        ...constellationSheet,
        id: `TEST-MAN-${manifestStat}`,
        stats: { ...constellationSheet.stats, manifest: manifestStat },
      },
    },
    gimmickId: null,
  });
  state = submitPairAction(state, state.pairs[0].id, {
    hunterActionId: 'hunter.wait',
    constellationActionId: 'const.manifest',
    hunterSubmitted: true,
    constellationSubmitted: true,
  });
  return previewRound(state).pairs[0].damageToEnemy;
}
check(
  '현신 스탯이 높으면 현신이 더 아프다',
  manifestDamage(6) > manifestDamage(1),
  `${manifestDamage(1)} → ${manifestDamage(6)}`,
);

/* ── 16. 회복 스킬 ──────────────────────────────────── */
console.log('\n=== 16. 회복 ===');

const healSkill: SkillDefinition = {
  id: 'SK-TEST-HEAL',
  side: 'HUNTER',
  kind: 'HEAL',
  name: 'FIELD SUTURE',
  description: '',
  apCost: 2,
  target: 'PAIR',
  power: 1.5,
  cooldown: 0,
  maxUses: null,
  applyStatusIds: [],
  special: '',
};
check('HEAL 스킬이 회복 효과로 변환된다', skillToAction(toRuntime([healSkill])[0]).effect.heal === 1.5);

let heal = createBattle({
  mode: 'DUEL',
  primaryPair: { hunterSheet: { ...hunterSheet, id: 'TEST-HEAL', skills: [healSkill] }, constellationSheet },
  gimmickId: null,
});
heal = { ...heal, pairs: [{ ...heal.pairs[0], hunter: { ...heal.pairs[0].hunter, hp: 40 } }] };
heal = submitPairAction(heal, heal.pairs[0].id, {
  hunterActionId: 'SK-TEST-HEAL',
  constellationActionId: 'const.wait',
  hunterSubmitted: true,
  constellationSubmitted: true,
});
const healPreview = previewRound(heal);
check(
  '회복량 = 최대 HP × 수치 × 계수',
  healPreview.pairs[0].heals[0]?.amount === 40,
  `amount ${healPreview.pairs[0].heals[0]?.amount}`,
);
const hpBeforeHeal = heal.pairs[0].hunter.hp;
heal = applyRound(heal, healPreview);
check('회복이 HP 에 반영된다', heal.pairs[0].hunter.hp > hpBeforeHeal, `HP ${hpBeforeHeal} → ${heal.pairs[0].hunter.hp}`);
check('회복 로그', heal.log.some((entry) => entry.text.includes('HEAL')));

// 회복 차단 상태에서는 회복되지 않는다
let blocked = createBattle({
  mode: 'DUEL',
  primaryPair: { hunterSheet: { ...hunterSheet, id: 'TEST-HB', skills: [healSkill] }, constellationSheet },
  gimmickId: null,
});
blocked = {
  ...blocked,
  pairs: [
    {
      ...blocked.pairs[0],
      hunter: {
        ...blocked.pairs[0].hunter,
        hp: 40,
        statuses: applyStatus([], 'heal.block', 'TEST'),
      },
    },
  ],
};
blocked = submitPairAction(blocked, blocked.pairs[0].id, {
  hunterActionId: 'SK-TEST-HEAL',
  constellationActionId: 'const.wait',
  hunterSubmitted: true,
  constellationSubmitted: true,
});
const blockedPreview = previewRound(blocked);
check('회복 차단 상태에서는 회복되지 않는다', blockedPreview.pairs[0].heals.length === 0);

/* ── 17. 아이템 ─────────────────────────────────────── */
console.log('\n=== 17. 아이템 ===');

check('기본 보급을 들고 시작한다', quantityOf(createBattle({ mode: 'DUEL', gimmickId: null }).pairs[0].inventory, 'item.medkit') === 2);
check('개수는 상한을 넘지 않는다', quantityOf(addItem([], 'item.medkit', 99), 'item.medkit') === ITEM_RULES.maxQuantity);
check('0 이하가 되면 항목이 사라진다', addItem([{ itemId: 'item.medkit', quantity: 1 }], 'item.medkit', -1).length === 0);
check('정의에 없는 아이템은 들어가지 않는다', addItem([], 'item.nope', 1).length === 0);
check('분류가 맞지 않으면 목록에 없다', inventoryFor(
  { ...createBattle({ mode: 'DUEL', gimmickId: null }).pairs[0] },
  'HUNTER',
).every((row) => row.item.id !== 'item.censer'));
check('성좌는 성유물을 들 수 있다', inventoryFor(
  { ...createBattle({ mode: 'DUEL', gimmickId: null }).pairs[0] },
  'CONSTELLATION',
).some((row) => row.item.id === 'item.censer'));

function itemBattle(itemId: string, quantity = 1) {
  const state = createBattle({ mode: 'DUEL', primaryPair: { hunterSheet, constellationSheet }, gimmickId: null });
  return {
    ...state,
    pairs: [{ ...state.pairs[0], inventory: addItem(state.pairs[0].inventory, itemId, quantity) }],
  };
}

// 회복 아이템
let medkit = itemBattle('item.medkit');
medkit = { ...medkit, pairs: [{ ...medkit.pairs[0], hunter: { ...medkit.pairs[0].hunter, hp: 40 } }] };
medkit = submitPairAction(medkit, medkit.pairs[0].id, {
  hunterActionId: 'hunter.item',
  hunterItemId: 'item.medkit',
  constellationActionId: 'const.wait',
  hunterSubmitted: true,
  constellationSubmitted: true,
});
const medkitPreview = previewRound(medkit);
check('아이템 행동이 유지된다', medkitPreview.pairs[0].hunterActionId === 'hunter.item', String(medkitPreview.pairs[0].hunterActionId));
check('아이템 비용은 아이템이 정한다', medkitPreview.pairs[0].apSpent.hunter === 1);
check('아이템 회복량', medkitPreview.pairs[0].heals[0]?.amount === 47, `amount ${medkitPreview.pairs[0].heals[0]?.amount}`);
const medkitBefore = quantityOf(medkit.pairs[0].inventory, 'item.medkit');
medkit = applyRound(medkit, medkitPreview);
check(
  '사용하면 개수가 줄어든다',
  quantityOf(medkit.pairs[0].inventory, 'item.medkit') === medkitBefore - 1,
  `${medkitBefore} → ${quantityOf(medkit.pairs[0].inventory, 'item.medkit')}`,
);
check('아이템 사용 로그', medkit.log.some((entry) => entry.text.includes('ITEM USED')));

// 공격 아이템 — 방어력을 무시하고 고정 피해
let grenade = itemBattle('item.grenade');
grenade = submitPairAction(grenade, grenade.pairs[0].id, {
  hunterActionId: 'hunter.item',
  hunterItemId: 'item.grenade',
  constellationActionId: 'const.wait',
  hunterSubmitted: true,
  constellationSubmitted: true,
});
const grenadePreview = previewRound(grenade);
check('아이템 고정 피해', grenadePreview.pairs[0].itemDamageToEnemy === 45, String(grenadePreview.pairs[0].itemDamageToEnemy));
const enemyHpBefore = grenade.enemies[0].hp;
grenade = applyRound(grenade, grenadePreview);
check(
  '아이템 피해가 적에게 들어간다',
  enemyHpBefore - grenade.enemies[0].hp >= 45,
  `${enemyHpBefore} → ${grenade.enemies[0].hp}`,
);
check(
  '아이템 상태이상이 걸린다',
  grenade.enemies[0].statuses.some((row) => row.defId === 'burn'),
  grenade.enemies[0].statuses.map((row) => row.defId).join(','),
);

// 상태이상 해제 아이템
let antidote = itemBattle('item.antidote');
antidote = {
  ...antidote,
  pairs: [
    {
      ...antidote.pairs[0],
      hunter: { ...antidote.pairs[0].hunter, statuses: applyStatus([], 'bleed', 'TEST') },
    },
  ],
};
antidote = submitPairAction(antidote, antidote.pairs[0].id, {
  hunterActionId: 'hunter.item',
  hunterItemId: 'item.antidote',
  constellationActionId: 'const.wait',
  hunterSubmitted: true,
  constellationSubmitted: true,
});
const antidotePreview = previewRound(antidote);
check('해제 대상 상태이상을 찾는다', antidotePreview.pairs[0].itemUses[0]?.cureStatusIds.includes('bleed') === true);
antidote = applyRound(antidote, antidotePreview);
check(
  '지속 피해가 해제된다',
  antidote.pairs[0].hunter.statuses.every((row) => row.defId !== 'bleed'),
  antidote.pairs[0].hunter.statuses.map((row) => row.defId).join(','),
);

// 행동력 회복 아이템
let starfruit = itemBattle('item.starfruit');
starfruit = submitPairAction(starfruit, starfruit.pairs[0].id, {
  hunterActionId: 'hunter.item',
  hunterItemId: 'item.starfruit',
  constellationActionId: 'const.wait',
  hunterSubmitted: true,
  constellationSubmitted: true,
});
check(
  '행동력 회복 아이템',
  previewRound(starfruit).pairs[0].itemUses[0]?.restoreAp === 2,
  String(previewRound(starfruit).pairs[0].itemUses[0]?.restoreAp),
);

// 성유물 — 계약 회복
let censer = itemBattle('item.censer');
censer = submitPairAction(censer, censer.pairs[0].id, {
  hunterActionId: 'hunter.attack',
  constellationActionId: 'const.relic',
  constellationItemId: 'item.censer',
  hunterSubmitted: true,
  constellationSubmitted: true,
});
const censerPreview = previewRound(censer);
check('성유물이 계약을 회복시킨다', censerPreview.pairs[0].contractDelta >= 18, `delta ${censerPreview.pairs[0].contractDelta}`);
censer = applyRound(censer, censerPreview);
check('계약이 상한을 넘지 않는다', censer.pairs[0].contract.value === 100, `value ${censer.pairs[0].contract.value}`);

// 성유물 — 성좌 상태 회복
let anchor = itemBattle('item.anchor');
anchor = {
  ...anchor,
  pairs: [
    { ...anchor.pairs[0], constellation: { ...anchor.pairs[0].constellation, stage: 'CRACKED' } },
  ],
};
anchor = submitPairAction(anchor, anchor.pairs[0].id, {
  hunterActionId: 'hunter.attack',
  constellationActionId: 'const.relic',
  constellationItemId: 'item.anchor',
  hunterSubmitted: true,
  constellationSubmitted: true,
});
const anchorPreview = previewRound(anchor);
check('성유물이 성좌 상태를 되돌린다 (예상)', anchorPreview.pairs[0].stageDrop === -1, String(anchorPreview.pairs[0].stageDrop));
anchor = applyRound(anchor, anchorPreview);
check('성좌 상태가 한 단계 회복된다', anchor.pairs[0].constellation.stage === 'UNSTABLE', anchor.pairs[0].constellation.stage);

// 부활 아이템
let lifeline = createBattle({ mode: 'RAID', pairCount: 2, gimmickId: null });
lifeline = {
  ...lifeline,
  pairs: [
    { ...lifeline.pairs[0], inventory: addItem(lifeline.pairs[0].inventory, 'item.lifeline', 1) },
    { ...lifeline.pairs[1], hunter: { ...lifeline.pairs[1].hunter, hp: 0 } },
  ],
};
lifeline = submitPairAction(lifeline, lifeline.pairs[0].id, {
  hunterActionId: 'hunter.item',
  hunterItemId: 'item.lifeline',
  supportTargetPairId: lifeline.pairs[1].id,
  constellationActionId: 'const.wait',
  hunterSubmitted: true,
  constellationSubmitted: true,
});
const lifelinePreview = previewRound(lifeline);
check('부활 아이템이 전투 불능 대상을 잡는다', lifelinePreview.pairs[0].itemUses[0]?.revive === true);
lifeline = applyRound(lifeline, lifelinePreview);
check('전투 불능에서 복귀한다', lifeline.pairs[1].hunter.hp > 0, `HP ${lifeline.pairs[1].hunter.hp}`);
check('복귀 경보', lifeline.alerts.some((a) => a.title === 'HUNTER RECOVERED'));

// 사용 불가 판정
const itemPair = itemBattle('item.floorpass').pairs[0];
check(
  '중요 아이템은 전투 중 쓸 수 없다',
  itemAvailability(itemPair, 'HUNTER', 'item.floorpass', true, null).usable === false,
  itemAvailability(itemPair, 'HUNTER', 'item.floorpass', true, null).reason,
);
check(
  '보유하지 않은 아이템은 쓸 수 없다',
  itemAvailability(itemPair, 'HUNTER', 'item.grenade', true, null).usable === false,
);
check(
  '헌터는 성유물을 쓸 수 없다',
  itemAvailability(itemPair, 'HUNTER', 'item.censer', true, null).usable === false,
);
check(
  '전투 불능 대상이 없으면 부활 아이템을 쓸 수 없다',
  itemAvailability(
    { ...itemPair, inventory: addItem(itemPair.inventory, 'item.lifeline', 1) },
    'HUNTER',
    'item.lifeline',
    true,
    null,
  ).usable === false,
);
check(
  '아이템을 고르지 않으면 아이템 행동이 자동 대체된다',
  (() => {
    let noItem = itemBattle('item.medkit');
    noItem = submitPairAction(noItem, noItem.pairs[0].id, {
      hunterActionId: 'hunter.item',
      constellationActionId: 'const.wait',
      hunterSubmitted: true,
      constellationSubmitted: true,
    });
    const row = previewRound(noItem).pairs[0];
    return row.hunterActionId !== 'hunter.item' && row.autoFilled.includes('HUNTER');
  })(),
);
check(
  '자동 행동은 아이템을 고르지 않는다',
  (AUTO_FORBIDDEN_KINDS as readonly string[]).includes('ITEM'),
);

/* ── 18. 계시 공유 (예지 권역) ──────────────────────── */
console.log('\n=== 18. 계시 공유 ===');

let omen = createBattle({ mode: 'RAID', pairCount: 4, gimmickId: null });
const omenPairIndex = omen.pairs.findIndex((row) => row.constellation.classId === 'omen');
check('예지 권역 페어가 편성에 있다', omenPairIndex >= 0, `index ${omenPairIndex}`);
omen = submitPairAction(omen, omen.pairs[omenPairIndex].id, {
  hunterActionId: 'hunter.attack',
  constellationActionId: 'const.revelation',
  hunterSubmitted: true,
  constellationSubmitted: true,
});
const omenPreview = previewRound(omen);
check('계시가 공략조 전체에 공유된다 (예상)', omenPreview.sharedReveal === true);
omen = applyRound(omen, omenPreview);
check(
  '모든 페어가 다음 패턴을 본다',
  omen.pairs.every((row) => row.patternRevealed),
  omen.pairs.map((row) => String(row.patternRevealed)).join(','),
);

/* ── 19. 포인트 · 보상 ─────────────────────────────── */
console.log('\n=== 19. 포인트 · 보상 ===');

check('보상 규칙 조회', findReward('BOSS_CLEAR').points === 300);
check('수동 지급 항목 분리', manualRewards().every((row) => !row.automatic));

let reward = createBattle({ mode: 'RAID', pairCount: 2, gimmickId: null });
reward = {
  ...reward,
  pairs: [reward.pairs[0], { ...reward.pairs[1], hunter: { ...reward.pairs[1].hunter, hp: 0 } }],
};
reward = submitPairAction(reward, reward.pairs[0].id, {
  hunterActionId: 'hunter.rescue',
  constellationActionId: 'const.buff',
  supportTargetPairId: reward.pairs[1].id,
  hunterSubmitted: true,
  constellationSubmitted: true,
});
const rewardPreview = previewRound(reward);
check(
  '구조는 포인트 보상을 만든다 (예상)',
  rewardPreview.pairs[0].rewards[0]?.points === 100,
  String(rewardPreview.pairs[0].rewards[0]?.points),
);
const pointsBefore = reward.pairs[0].points;
reward = applyRound(reward, rewardPreview);
check(
  '보상이 보유 포인트에 더해진다',
  reward.pairs[0].points === pointsBefore + 100,
  `${pointsBefore} → ${reward.pairs[0].points}`,
);
check(
  '지급 내역이 원장에 남는다',
  reward.rewards.some((row) => row.reason === 'PAIR_RESCUE' && row.pairId === reward.pairs[0].id),
  reward.rewards.map((row) => row.reason).join(','),
);
check('원장 합계 조회', earnedBy(reward, reward.pairs[0].id) === 100);

// 클리어 보상
let cleared = createBattle({ mode: 'DUEL', primaryPair: { hunterSheet, constellationSheet }, gimmickId: null });
// 방어 전담형의 기본 공격은 무겁지 않다 — 마지막 한 방만 남긴다
cleared = { ...cleared, enemies: [{ ...cleared.enemies[0], hp: 1 }] };
const clearedPointsBefore = cleared.pairs[0].points;
cleared = submitPairAction(cleared, cleared.pairs[0].id, {
  hunterActionId: 'hunter.attack',
  constellationActionId: 'const.buff',
  hunterSubmitted: true,
  constellationSubmitted: true,
});
cleared = applyRound(cleared, previewRound(cleared));
check('보스 층 클리어 → 300P', cleared.pairs[0].points === clearedPointsBefore + 300, `${clearedPointsBefore} → ${cleared.pairs[0].points}`);
check('클리어 원장', cleared.rewards.some((row) => row.reason === 'BOSS_CLEAR'));

// 기믹 해제 보상 — 8장에서 만든 상태를 다시 쓰지 않고 새로 확인한다
check(
  '기믹 해제 → 숨겨진 기믹 보상',
  gimmick.rewards.some((row) => row.reason === 'HIDDEN_GIMMICK'),
  gimmick.rewards.map((row) => `${row.label}:${row.points}`).join(','),
);

// 운영진 수동 지급 · 취소
let manual = createBattle({ mode: 'DUEL', gimmickId: null });
const manualBefore = manual.pairs[0].points;
manual = admin.grantPoints(manual, manual.pairs[0].id, 'SUB_MISSION', 120);
check('운영진 수동 지급', manual.pairs[0].points === manualBefore + 120, `${manualBefore} → ${manual.pairs[0].points}`);
manual = admin.revokeReward(manual, manual.rewards[0].id);
check('지급 취소로 되돌아온다', manual.pairs[0].points === manualBefore && manual.rewards.length === 0);

// 운영진 아이템 지급 · 회수
let itemAdmin = createBattle({ mode: 'DUEL', gimmickId: null });
itemAdmin = admin.grantItem(itemAdmin, itemAdmin.pairs[0].id, 'item.grenade', 2);
check('운영진 아이템 지급', quantityOf(itemAdmin.pairs[0].inventory, 'item.grenade') === 2);
itemAdmin = admin.revokeItem(itemAdmin, itemAdmin.pairs[0].id, 'item.grenade', 1);
check('운영진 아이템 회수', quantityOf(itemAdmin.pairs[0].inventory, 'item.grenade') === 1);
check(
  '계약 값을 바꾸면 단계도 따라온다',
  admin.setContract(itemAdmin, itemAdmin.pairs[0].id, { value: 20 }).pairs[0].contract.stage ===
    'FRACTURED',
);

/* ── 20. 보급 상점 ──────────────────────────────────── */
console.log('\n=== 20. 보급 상점 ===');

const bond: PairBond = {
  id: 'BOND-TEST',
  label: 'PAIR 01',
  hunterAccountId: 'h',
  constellationAccountId: 'c',
  hunterName: '테스트 헌터',
  constellationName: '테스트 성좌',
  affiliation: 'GOVERNMENT',
  active: true,
  createdAt: '1970-01-01T00:00:00.000Z',
};

/** 소지금과 가방은 개인 소유다 — 상점은 지갑 하나만 알면 된다 */
const wallet: Wallet = { points: 300, inventory: [] };

const bought = purchase(wallet, 'item.medkit', 2);
check('구매 성공', bought.ok === true, bought.reason);
check('가격만큼 차감된다', bought.points === 300 - 160, `points ${bought.points}`);
check('가방에 들어간다', quantityOf(bought.inventory, 'item.medkit') === 2);

const tooExpensive = purchase(wallet, 'item.anchor', 1);
check('포인트가 부족하면 거절', tooExpensive.ok === false, tooExpensive.reason);
const overLimit = purchase({ ...wallet, points: 9999 }, 'item.lifeline', 3);
check('보유 한도를 넘으면 거절', overLimit.ok === false, overLimit.reason);
check('취급하지 않는 품목은 거절', purchase(wallet, 'item.floorpass', 1).ok === false);

const stocked = withPurchase(wallet, bought);
const refunded = refund(stocked, 'item.medkit');
check('반납은 절반을 환급한다', refunded.ok === true && refunded.points === bought.points + 40, `points ${refunded.points}`);
check('보유하지 않으면 반납 거절', refund(wallet, 'item.grenade').ok === false);

/* ── 21. 공략 기록 · 정산 ───────────────────────────── */
console.log('\n=== 21. 공략 기록 ===');

const record = buildRecord(cleared, new Date(0), '');
check('기록에 스키마 버전이 담긴다', record.schemaVersion === SCHEMA_VERSION);
check('기록 상태', record.status === 'CLEARED');
check('기록에 라운드 수', record.rounds === cleared.round);
check('기록에 보스 이름', record.bossName === cleared.enemies[0].name, String(record.bossName));
check('기록에 획득 포인트', record.pairs[0].pointsEarned === 300, String(record.pairs[0].pointsEarned));
check('기록에 보유 포인트', record.pairs[0].pointsTotal === cleared.pairs[0].points);
check('기록에 로그 사본', record.log.length === cleared.log.length);
check('기록은 정산 대상', settleable(record) === true);

// 헌터는 구급 키트 2개를 들고 들어갔고, 성좌는 빈 손이다
const settleTargets: SettlementTarget[] = [
  { accountId: 'h', side: 'HUNTER', points: 100, inventory: [{ itemId: 'item.medkit', quantity: 2 }] },
  { accountId: 'c', side: 'CONSTELLATION', points: 50, inventory: [] },
];
const settled = settle(
  { ...record, pairs: [{ ...record.pairs[0], label: 'PAIR 01', inventory: [] }] },
  [bond],
  settleTargets,
);
const settledHunter = settled.targets.find((row) => row.accountId === 'h');
const settledConstellation = settled.targets.find((row) => row.accountId === 'c');

check('정산은 두 사람 각자에게 포인트를 준다', settledHunter?.points === 400 && settledConstellation?.points === 350, `${settledHunter?.points} / ${settledConstellation?.points}`);
check('정산 내역이 사람 수만큼 남는다', settled.rows.length === 2 && settled.rows[0]?.earned === 300);
check(
  '전투에서 쓴 만큼 개인 가방에서 빠진다',
  quantityOf(settledHunter?.inventory ?? [], 'item.medkit') === 0,
);
check(
  '라벨이 다르면 정산하지 않는다',
  settle({ ...record, pairs: [{ ...record.pairs[0], label: 'PAIR 99' }] }, [bond], settleTargets)
    .rows.length === 0,
);

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
if (failures > 0) {
  throw new Error(`${failures} FAILURE(S)`);
}
