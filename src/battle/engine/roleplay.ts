/**
 * 연출 로그 생성.
 *
 * 시스템 로그(수치 기록)와 별개로, 커뮤니티 진행에 바로 붙여 쓸 수 있는
 * 서술형 텍스트를 만든다. 생성 후 운영진이 수정할 수 있어야 하므로
 * 결과는 하나의 문자열 블록으로 돌려준다.
 */

import { findGimmick } from '../config/gimmicks';
import { fill } from '../config/roleplay';
import { findStatus } from '../config/status';
import type { BattleState, RoundPreview } from '../types';

export function buildRoleplayText(state: BattleState, preview: RoundPreview): string {
  const blocks: string[] = [fill('roundHeader', { round: String(preview.round).padStart(2, '0') })];
  const enemyDamage = new Map<string, number>();

  for (const row of preview.pairs) {
    const pair = state.pairs.find((candidate) => candidate.id === row.pairId);
    if (!pair) continue;

    const lines: string[] = [];
    const hunterName = pair.hunter.name;
    const constellationName = pair.constellation.name;
    const enemy = state.enemies.find((candidate) => candidate.id === row.targetEnemyId);
    const enemyName = enemy?.name ?? '적';

    // 성좌 행동
    switch (row.constellationActionId) {
      case null:
        break;
      case 'const.buff':
      case 'const.buff.heavy':
        lines.push(fill('constellationBuff', { constellation: constellationName, hunter: hunterName }));
        break;
      case 'const.debuff':
      case 'const.debuff.heavy':
        lines.push(fill('constellationDebuff', { constellation: constellationName, enemy: enemyName }));
        break;
      case 'const.revelation':
        lines.push(fill('constellationRevelation', { constellation: constellationName, hunter: hunterName }));
        break;
      case 'const.manifest':
      case 'const.manifest.full':
        lines.push(fill('constellationManifest', { constellation: constellationName }));
        break;
      default:
        if (row.constellationActionLabel !== '—') {
          lines.push(
            fill('constellationBuff', { constellation: constellationName, hunter: hunterName }),
          );
        }
    }

    // 헌터 행동
    if (row.rescue) {
      lines.push(fill('hunterRescue', { hunter: hunterName, target: row.rescue.targetLabel }));
    } else if (row.gimmickProgress > 0) {
      lines.push(fill('hunterGimmick', { hunter: hunterName }));
    } else if (row.hunterActionId === 'hunter.defend') {
      lines.push(fill('hunterDefend', { hunter: hunterName }));
    } else if (row.damageToEnemy > 0) {
      lines.push(fill('hunterAttack', { hunter: hunterName, action: row.hunterActionLabel }));
    }

    if (row.combo) {
      lines.push(fill('combo', { combo: row.combo.label }));
    }

    if (row.damageToEnemy > 0 && enemy) {
      lines.push(fill('damage', { enemy: enemyName, damage: row.damageToEnemy }));
      enemyDamage.set(enemy.id, (enemyDamage.get(enemy.id) ?? 0) + row.damageToEnemy);
    }

    for (const application of row.appliedStatuses) {
      const def = findStatus(application.defId);
      if (!def || def.kind === 'BUFF') continue;
      const targetName = application.holder === 'ENEMY' ? enemyName : hunterName;
      lines.push(fill('statusApplied', { target: targetName, status: def.labelKo }));
    }

    if (lines.length > 0) blocks.push(lines.join('\n'));
  }

  // 적 행동
  for (const row of preview.enemies) {
    const lines: string[] = [];
    if (row.telegraph) {
      lines.push(fill('telegraph', { enemy: row.enemyName, message: row.telegraph.message }));
    } else if (row.blocked) {
      lines.push(`${row.enemyName}의 움직임이 봉인되어 있습니다.`);
    } else if (row.aoe) {
      lines.push(fill('enemyAoe', { enemy: row.enemyName, pattern: row.pattern }));
      for (const hit of row.hits) {
        lines.push(`  · ${hit.pairLabel} — ${hit.damage}`);
      }
    } else {
      for (const hit of row.hits) {
        lines.push(
          fill('enemyAttack', {
            enemy: row.enemyName,
            pattern: row.pattern,
            target: hit.pairLabel,
            damage: hit.damage,
          }),
        );
      }
    }
    if (lines.length > 0) blocks.push(lines.join('\n'));
  }

  // 지속 피해
  const dotLines = preview.statusTicks.map((tick) =>
    fill('dot', { target: tick.ownerLabel, status: findStatus(tick.defId)?.labelKo ?? tick.label, damage: tick.amount }),
  );
  if (dotLines.length > 0) blocks.push(dotLines.join('\n'));

  // 적 HP 변화
  for (const enemy of state.enemies) {
    const damage =
      (enemyDamage.get(enemy.id) ?? 0) +
      preview.statusTicks
        .filter((tick) => tick.holder === 'ENEMY' && tick.ownerId === enemy.id)
        .reduce((sum, tick) => sum + tick.amount, 0);
    if (damage <= 0) continue;
    blocks.push(
      `${enemy.name}\n${fill('hpLine', { before: enemy.hp, after: Math.max(0, enemy.hp - damage) })}`,
    );
  }

  // 기믹
  if (preview.gimmick && state.gimmick) {
    const def = findGimmick(state.gimmick.defId);
    if (preview.gimmick.willClear) {
      blocks.push(
        fill('gimmickCleared', {
          gimmick: state.gimmick.labelKo,
          message: def?.onClear.message ?? '',
        }),
      );
    } else if (preview.gimmick.willFail) {
      blocks.push(
        fill('gimmickFailed', {
          gimmick: state.gimmick.labelKo,
          message: def?.onFail.message ?? '',
        }),
      );
    }
  }

  return blocks.join('\n\n');
}
