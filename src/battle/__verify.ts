/* 검증 스크립트 — `npm run verify:battle` 로 실행한다. */
import { POINT_BUY, initialStats, remainingPoints } from './config/characters';
import { pairPreset, presetSheet } from './config/scenario';
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
import { evaluatePhase, selectPattern } from './engine/enemy';
import { declarationValid, planCheck } from './engine/gimmick';
import { applyRound, previewRound, setControlMode, submitPairAction } from './engine/round';
import { skillToAction, toRuntime } from './engine/skills';
import { aggregateModifiers, applyStatus, injuryOf, tickStatuses } from './engine/status';
import type { BattleState, CharacterSheet, SkillDefinition } from './types';

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
  concept: '',
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
  concept: '',
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
  concept: '',
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

// 다이스
console.log('\n=== 8-2. 다이스 ===');
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

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
if (failures > 0) {
  throw new Error(`${failures} FAILURE(S)`);
}
