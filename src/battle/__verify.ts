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
import { applyRound, previewRound, setControlMode, submitPairAction } from './engine/round';
import { injuryOf } from './engine/status';
import type { BattleState, CharacterSheet } from './types';

let failures = 0;
function check(label: string, condition: boolean, extra = '') {
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
}

/* ── 1. 캐릭터 시트 → 전투 수치 ─────────────────────── */
console.log('\n=== 1. 캐릭터 시트 파생 ===');

const hunterSheet: CharacterSheet = {
  id: 'TEST-H',
  side: 'HUNTER',
  name: '테스트 헌터',
  classId: 'guardian',
  stats: { str: 2, vit: 6, agi: 4, sen: 2, wil: 3 },
  concept: '',
  affiliation: 'GOVERNMENT',
  createdAt: '1970-01-01T00:00:00.000Z',
};
const derivedHunter = deriveHunter(hunterSheet);
// 60 + 6*8 + 25 = 133 / 4 + 2*1.2 - 1 = 5.4 → 5 / 4*0.8 + 3 = 6.2 → 6
check('VIT → 최대 HP', derivedHunter.maxHp === 133, `maxHp ${derivedHunter.maxHp}`);
check('STR + 클래스 → 공격력', derivedHunter.attack === 5, `attack ${derivedHunter.attack}`);
check('AGI + 클래스 → 방어력', derivedHunter.defense === 6, `defense ${derivedHunter.defense}`);

const constellationSheet: CharacterSheet = {
  id: 'TEST-C',
  side: 'CONSTELLATION',
  name: '테스트 성좌',
  classId: 'calamity',
  stats: { authority: 6, divinity: 3, resonance: 1, observation: 4, manifest: 3 },
  concept: '',
  affiliation: 'GOVERNMENT',
  createdAt: '1970-01-01T00:00:00.000Z',
};
const derivedConst = deriveConstellation(constellationSheet);
// 1 + 6*0.04 + 0.15 = 1.39 / 5 + floor(3/3) = 6
check('AUT + 권역 → 권능 배율', derivedConst.power === 1.39, `power ${derivedConst.power}`);
check('DIV → 최대 행동력', derivedConst.maxAp === 6, `maxAp ${derivedConst.maxAp}`);

const hunterState = hunterStateFromSheet(hunterSheet);
check('시트 id 추적', hunterState.sheetId === 'TEST-H' && hunterState.classId === 'guardian');
check('시작 HP 는 만피', hunterState.hp === hunterState.maxHp);
check(
  '성좌 상태 기본 STABLE',
  constellationStateFromSheet(constellationSheet).stage === 'STABLE',
);

/* ── 2. 시트 검증 ───────────────────────────────────── */
console.log('\n=== 2. 시트 검증 ===');
const blank = { side: 'HUNTER' as const, name: '', classId: '', stats: initialStats('HUNTER'), concept: '' };
const blankIssues = validateSheet(blank);
check('빈 시트는 이름·클래스·스탯 오류', blankIssues.length === 3, blankIssues.map((i) => i.field).join(','));
check('배분 전 남은 포인트', remainingPoints('HUNTER', initialStats('HUNTER')) === POINT_BUY.freePoints);
check(
  '완성된 시트는 오류 없음',
  validateSheet({ ...hunterSheet, concept: '' }).length === 0,
  validateSheet(hunterSheet).map((i) => i.message).join(' / '),
);
check(
  '초과 배분 감지',
  validateSheet({ ...hunterSheet, stats: { ...hunterSheet.stats, str: 6 } }).length === 1,
);

/* ── 3. DUEL 한 라운드 ──────────────────────────────── */
console.log('\n=== 3. DUEL 라운드 진행 ===');
let duel = createBattle({ mode: 'DUEL' });
check('페어 1조 / 적 1체', duel.pairs.length === 1 && duel.enemies.length === 1);
const preset0 = pairPreset(0);
const presetHunter = deriveHunter(presetSheet(preset0.hunter, 'HUNTER', 'GOVERNMENT', 0));
check(
  '프리셋도 시트 파생 경로를 통과',
  duel.pairs[0].hunter.attack === presetHunter.attack &&
    duel.pairs[0].hunter.maxHp === presetHunter.maxHp,
  `attack ${duel.pairs[0].hunter.attack} / maxHp ${duel.pairs[0].hunter.maxHp}`,
);

const pairId = duel.pairs[0].id;
duel = submitPairAction(duel, pairId, {
  hunterActionId: 'hunter.attack',
  constellationActionId: 'const.debuff',
  submitted: true,
});

const duelPreview = previewRound(duel);
const row = duelPreview.pairs[0];
console.log('  근거:', row.notes.join(' | '));
check('디버프 + 권능 배율 반영', row.damageToEnemy > 0, `damage=${row.damageToEnemy}`);
check('권능 배율이 근거에 표시', row.notes.some((note) => note.includes('권능 배율')));
check('자동 행동 없음', row.autoFilled.length === 0);
check('적 반격 예상', duelPreview.enemies[0].damageToHunter > 0, `-${duelPreview.enemies[0].damageToHunter}`);
check(
  '헌터 방어력이 반격을 깎음',
  duelPreview.enemies[0].notes.some((note) => note.includes('헌터 방어력')),
  duelPreview.enemies[0].notes.join(' | '),
);

const enemyHpBefore = duel.enemies[0].hp;
duel = applyRound(duel, duelPreview);
check('적 HP 감소', duel.enemies[0].hp === enemyHpBefore - row.damageToEnemy, `${enemyHpBefore} → ${duel.enemies[0].hp}`);
check('헌터 피해 반영', duel.pairs[0].hunter.hp < duel.pairs[0].hunter.maxHp, `HP ${duel.pairs[0].hunter.hp}`);
check('라운드 진행', duel.round === 2);
check('제출 초기화', duel.pairs[0].submission.submitted === false);
check('로그 기록', duel.log.length > 0, `${duel.log.length}건`);

/* ── 4. 자동 행동 ───────────────────────────────────── */
console.log('\n=== 4. 자동 행동 ===');
let solo = createBattle({ mode: 'DUEL' });
solo = setControlMode(solo, solo.pairs[0].id, 'CONSTELLATION', 'AUTO');
solo = submitPairAction(solo, solo.pairs[0].id, { hunterActionId: 'hunter.attack', submitted: true });
const soloRow = previewRound(solo).pairs[0];
check('성좌만 자동 위임', soloRow.autoFilled.length === 1 && soloRow.autoFilled[0] === 'CONSTELLATION');
check('자동 행동이 채워짐', Boolean(soloRow.constellationActionId), String(soloRow.constellationActionId));
check('현신을 자동으로 고르지 않음', soloRow.constellationActionId !== 'const.manifest.full');

const unsubmitted = createBattle({ mode: 'DUEL' });
check(
  '미제출이면 양쪽 모두 자동',
  previewRound(unsubmitted).pairs[0].autoFilled.length === 2,
);

/* ── 5. 레이드 ──────────────────────────────────────── */
console.log('\n=== 5. 레이드 ===');
let raid = createBattle({ mode: 'RAID', pairCount: 4, monsterCount: 1 });
check('레이드 4페어 / 적 2체', raid.pairs.length === 4 && raid.enemies.length === 2);
const lowHp = raid.pairs[3];
check(
  '프리셋 hpRatio 반영',
  lowHp.hunter.hp < lowHp.hunter.maxHp * 0.4,
  `HP ${lowHp.hunter.hp}/${lowHp.hunter.maxHp}`,
);

const raidPreview = previewRound(raid);
const lowRow = raidPreview.pairs.find((r) => r.pairId === lowHp.id)!;
check('HP 40% 미만 → 자동 방어', lowRow.hunterActionId === 'hunter.defend', String(lowRow.hunterActionId));
const healthyRow = raidPreview.pairs.find((r) => r.pairId === raid.pairs[0].id)!;
check('건강한 헌터 → 자동 공격', healthyRow.hunterActionId === 'hunter.attack', String(healthyRow.hunterActionId));
check(
  '적 2체가 서로 다른 페어를 노림',
  new Set(raidPreview.enemies.map((e) => e.targetPairId)).size === 2,
  raidPreview.enemies.map((e) => `${e.enemyName}→${e.targetPairId}`).join(', '),
);
check('총 피해 합산', raidPreview.totals.damageToEnemies > 0, String(raidPreview.totals.damageToEnemies));

raid = applyRound(raid, raidPreview);
const r1Targets = raidPreview.enemies.map((e) => e.targetPairId).join('|');
const r2Targets = previewRound(raid).enemies.map((e) => e.targetPairId).join('|');
check('라운드마다 대상 순환', r1Targets !== r2Targets, `${r1Targets} → ${r2Targets}`);

/* ── 6. 성좌 상태 패널티 ────────────────────────────── */
console.log('\n=== 6. 성좌 상태 ===');
const unstable = raid.pairs[2];
const unstableSheet = presetSheet(pairPreset(2).constellation, 'CONSTELLATION', 'GOVERNMENT', 2);
check(
  'UNSTABLE 성좌는 최대 AP -1',
  unstable.constellation.maxAp === deriveConstellation(unstableSheet).maxAp - 1,
  `maxAp ${unstable.constellation.maxAp}`,
);
check('UNSTABLE 상태 유지', unstable.constellation.stage === 'UNSTABLE');

/* ── 7. 참가자 페어 편성 ────────────────────────────── */
console.log('\n=== 7. 참가자 페어 편성 ===');
const custom = createBattle({
  mode: 'RAID',
  pairCount: 3,
  primaryPair: { hunterSheet, constellationSheet },
});
check('PAIR 01 이 참가자 시트', custom.pairs[0].hunter.sheetId === 'TEST-H');
check('상대 시트도 반영', custom.pairs[0].constellation.sheetId === 'TEST-C');
check('나머지는 프리셋', custom.pairs[1].hunter.sheetId?.startsWith('NPC-') === true);
check('시트 소속 승계', custom.pairs[0].affiliation === 'GOVERNMENT');
check('viewerPair 는 PAIR 01', viewerPair(custom).id === custom.pairs[0].id);

/* ── 8. 전투 종료 판정 ──────────────────────────────── */
console.log('\n=== 8. 종료 판정 ===');
let ending: BattleState = createBattle({ mode: 'DUEL' });
ending = { ...ending, enemies: [{ ...ending.enemies[0], hp: 3 }] };
ending = submitPairAction(ending, ending.pairs[0].id, {
  hunterActionId: 'hunter.attack',
  constellationActionId: 'const.buff',
  submitted: true,
});
ending = applyRound(ending, previewRound(ending));
check('적 처치 → CLEARED', ending.status === 'CLEARED', ending.status);

let wipe: BattleState = createBattle({ mode: 'DUEL' });
wipe = { ...wipe, pairs: [{ ...wipe.pairs[0], hunter: { ...wipe.pairs[0].hunter, hp: 1 } }] };
wipe = applyRound(wipe, previewRound(wipe));
check('헌터 전멸 → FAILED', wipe.status === 'FAILED', wipe.status);
check('부상 단계 DOWN', injuryOf(wipe.pairs[0].hunter).stage === 'DOWN');

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
if (failures > 0) {
  // @types/node 를 의존성에 추가하지 않기 위해 예외로 종료 코드를 낸다.
  throw new Error(`${failures} FAILURE(S)`);
}
