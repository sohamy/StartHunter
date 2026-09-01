/**
 * 라운드 미리보기 — 상태를 바꾸지 않고 예상 결과만 만든다.
 *
 * 적용(apply.ts)과 나뉘어 있는 것은 그 사이에 **운영진 수정 단계**가 들어가기 때문이다.
 * 자동 판정 결과를 운영진이 언제든 덮어쓸 수 있어야 한다.
 */

import type { BattleState, RoundPreview } from '../../types';
import { revelationShared } from '../traits';
import { mergeEnemyStatuses, previewEnemies, previewStatusTicks } from './enemy-turn';
import { previewPair } from './pair';


/* ── 미리보기 ──────────────────────────────────────────── */

export function previewRound(state: BattleState): RoundPreview {
  const pairPreviews = state.pairs.map((pair) => previewPair(state, pair));
  const mergedEnemyStatuses = mergeEnemyStatuses(state, pairPreviews);
  const enemyPreviews = previewEnemies(state, pairPreviews, mergedEnemyStatuses);
  const statusTicks = previewStatusTicks(state, pairPreviews, mergedEnemyStatuses);

  // 예지 권역의 계시는 공략조 전체가 함께 본다
  const sharedReveal = state.pairs.some(
    (pair) =>
      revelationShared(pair.constellation) &&
      pairPreviews.find((row) => row.pairId === pair.id)?.revealPattern === true,
  );

  // 기믹 진행 예상
  let gimmick: RoundPreview['gimmick'] = null;
  if (state.gimmick && state.gimmick.status === 'ACTIVE') {
    const progress =
      state.gimmick.progress + pairPreviews.reduce((sum, row) => sum + row.gimmickProgress, 0);
    const willClear = progress >= state.gimmick.required;
    const roundsLeft = state.gimmick.roundsLeft;
    gimmick = {
      progress,
      required: state.gimmick.required,
      willClear,
      willFail: !willClear && roundsLeft !== null && roundsLeft - 1 <= 0,
    };
  }

  const alerts: RoundPreview['alerts'] = [];
  for (const row of enemyPreviews) {
    if (row.telegraph) {
      alerts.push({
        level: 'TOWER',
        title: 'TOWER ALERT',
        message: `${row.enemyName} — ${row.telegraph.message}`,
      });
    }
  }
  if (gimmick?.willFail) {
    alerts.push({
      level: 'EMERGENCY',
      title: 'GIMMICK FAILURE',
      message: `${state.gimmick?.label} 해제 실패가 임박했습니다.`,
    });
  }

  return {
    round: state.round,
    pairs: pairPreviews,
    enemies: enemyPreviews,
    statusTicks,
    gimmick,
    sharedReveal,
    alerts,
    totals: {
      damageToEnemies:
        pairPreviews.reduce((sum, row) => sum + row.damageToEnemy + row.itemDamageToEnemy, 0) +
        statusTicks.filter((tick) => tick.holder === 'ENEMY').reduce((sum, t) => sum + t.amount, 0),
      damageToHunters:
        enemyPreviews.reduce((sum, row) => sum + row.damageToHunter, 0) +
        statusTicks.filter((tick) => tick.holder === 'HUNTER').reduce((sum, t) => sum + t.amount, 0),
    },
  };
}

