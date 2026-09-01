/**
 * 적의 차례와 지속 효과.
 *
 * 적이 무엇을 하는지는 패턴이 정한다(config/patterns · 운영진이 만든 공격 목록).
 * 상태이상의 시간 경과(도트 피해 · 남은 라운드)도 여기서 함께 센다.
 */

import { findStatus } from '../../config/status';
import type {
  BattleState,
  EnemyActionPreview,
  PairPreview,
  StatusApplication,
  StatusEffect,
  StatusTick,
} from '../../types';
import { enemyAttackDamage } from '../damage';
import { selectPattern } from '../enemy';
import { aggregateModifiers, applyStatus } from '../status';
import { statusResistRounds } from '../traits';


/* ── 적 행동 (패턴) ────────────────────────────────────── */

export function previewEnemies(
  state: BattleState,
  pairPreviews: PairPreview[],
  mergedEnemyStatuses: Map<string, StatusEffect[]>,
): EnemyActionPreview[] {
  const livingPairs = state.pairs.filter((pair) => pair.hunter.hp > 0);
  if (livingPairs.length === 0) return [];

  return state.enemies
    .filter((enemy) => enemy.hp > 0)
    .map((enemy, enemyIndex) => {
      const enemyStatuses = mergedEnemyStatuses.get(enemy.id) ?? enemy.statuses;
      const enemyMods = aggregateModifiers(enemyStatuses);
      const pattern = selectPattern(enemy, state.round);
      const patternLabel = pattern?.label ?? enemy.nextPattern;

      const base: EnemyActionPreview = {
        enemyId: enemy.id,
        enemyName: enemy.name,
        pattern: patternLabel,
        patternId: pattern?.id ?? null,
        aoe: pattern?.shape === 'AOE',
        hits: [],
        targetPairId: null,
        damageToHunter: 0,
        appliedStatuses: [],
        blocked: false,
        telegraph: null,
        notes: [],
      };

      if (enemyMods.blockAction) {
        return { ...base, blocked: true, notes: ['행동 불가 상태 — 패턴 취소'] };
      }

      // 예고 패턴 — 이번 라운드에는 공격하지 않고 다음을 알린다
      if (pattern?.shape === 'TELEGRAPH') {
        return {
          ...base,
          telegraph: {
            patternId: pattern.id,
            label: pattern.label,
            message: pattern.telegraphMessage ?? '',
            roundsLeft: pattern.telegraphRounds ?? 1,
          },
          notes: [pattern.telegraphMessage ?? pattern.description],
        };
      }

      // 자기 강화 패턴
      if (pattern?.shape === 'BUFF') {
        return {
          ...base,
          appliedStatuses: pattern.selfStatusIds.map((defId) => ({
            holder: 'ENEMY' as const,
            ownerId: enemy.id,
            defId,
            label: findStatus(defId)?.label ?? defId,
            scale: 1,
          })),
          notes: [pattern.description],
        };
      }

      const targets =
        pattern?.shape === 'AOE'
          ? livingPairs
          : [livingPairs[(state.round - 1 + enemyIndex) % livingPairs.length]];

      const hits = targets.map((target) => {
        const preview = pairPreviews.find((row) => row.pairId === target.id);
        const result = enemyAttackDamage({
          enemy: { ...enemy, attack: Math.round(enemy.attack * (pattern?.powerRatio ?? 1)) },
          hunter: target.hunter,
          damageReduction: preview?.damageReduction ?? 0,
          hunterModifiers: aggregateModifiers(target.hunter.statuses),
          enemyModifiers: enemyMods,
        });
        return { pairId: target.id, pairLabel: target.label, damage: result.amount, notes: result.notes };
      });

      const appliedStatuses: StatusApplication[] = [];
      for (const defId of pattern?.applyStatusIds ?? []) {
        const def = findStatus(defId);
        if (!def) continue;
        for (const hit of hits) {
          // 헌터의 의지가 적이 건 디버프의 지속시간을 깎는다. 버프는 깎지 않는다.
          const target = livingPairs.find((row) => row.id === hit.pairId);
          const resist =
            target && def.kind !== 'BUFF' ? -statusResistRounds(target.hunter) : 0;
          appliedStatuses.push({
            holder: 'HUNTER',
            ownerId: hit.pairId,
            defId,
            label: def.label,
            scale: 1,
            durationBonus: resist,
          });
        }
      }

      return {
        ...base,
        hits: hits.map(({ pairId, pairLabel, damage }) => ({ pairId, pairLabel, damage })),
        targetPairId: pattern?.shape === 'AOE' ? null : hits[0]?.pairId ?? null,
        damageToHunter: hits.reduce((sum, hit) => sum + hit.damage, 0),
        appliedStatuses,
        notes: [
          pattern ? `${pattern.label} — ${pattern.labelKo}` : '단일 공격',
          pattern?.shape === 'AOE' ? `광역 · 대상 ${hits.length}페어` : `대상 ${hits[0]?.pairLabel}`,
          ...(hits[0]?.notes ?? []),
        ],
      };
    });
}

export function mergeEnemyStatuses(
  state: BattleState,
  pairPreviews: PairPreview[],
): Map<string, StatusEffect[]> {
  const merged = new Map<string, StatusEffect[]>();
  for (const enemy of state.enemies) {
    merged.set(enemy.id, enemy.statuses);
  }

  for (const row of pairPreviews) {
    for (const application of row.appliedStatuses) {
      if (application.holder !== 'ENEMY') continue;
      const current = merged.get(application.ownerId);
      if (!current) continue;
      merged.set(
        application.ownerId,
        applyStatus(
          current,
          application.defId,
          row.pairLabel,
          application.scale,
          application.durationBonus ?? 0,
        ),
      );
    }
  }

  return merged;
}

export function previewStatusTicks(
  state: BattleState,
  pairPreviews: PairPreview[],
  mergedEnemyStatuses: Map<string, StatusEffect[]>,
): StatusTick[] {
  const ticks: StatusTick[] = [];

  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    const statuses = mergedEnemyStatuses.get(enemy.id) ?? enemy.statuses;
    for (const effect of statuses) {
      const def = findStatus(effect.defId);
      if (!def?.modifiers.dotDamage) continue;
      ticks.push({
        holder: 'ENEMY',
        ownerId: enemy.id,
        ownerLabel: enemy.name,
        defId: def.id,
        label: def.label,
        amount: dotAmount(def.modifiers.dotDamage, effect),
      });
    }
  }

  for (const pair of state.pairs) {
    if (pair.hunter.hp <= 0) continue;
    const applied = pairPreviews.find((row) => row.pairId === pair.id);
    let statuses = pair.hunter.statuses;
    for (const application of applied?.appliedStatuses ?? []) {
      if (application.holder === 'HUNTER' && application.ownerId === pair.id) {
        statuses = applyStatus(
          statuses,
          application.defId,
          pair.label,
          application.scale,
          application.durationBonus ?? 0,
        );
      }
    }

    for (const effect of statuses) {
      const def = findStatus(effect.defId);
      if (!def?.modifiers.dotDamage) continue;
      ticks.push({
        holder: 'HUNTER',
        ownerId: pair.id,
        ownerLabel: `${pair.label} ${pair.hunter.name}`,
        defId: def.id,
        label: def.label,
        amount: dotAmount(def.modifiers.dotDamage, effect),
      });
    }
  }

  return ticks;
}

function dotAmount(base: number, effect: StatusEffect): number {
  return Math.max(1, Math.round(base * Math.max(1, effect.stacks) * (effect.scale ?? 1)));
}

