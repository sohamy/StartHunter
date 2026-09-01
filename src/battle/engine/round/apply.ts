/**
 * 미리보기를 실제 상태로 굳힌다.
 *
 * 여기서부터는 되돌릴 수 없다 — HP · 상태이상 · 계약 · 기믹 · 보상 원장이 모두 바뀌고
 * 로그가 남는다. 운영진이 preview 를 고쳤다면 **고친 값이 그대로** 반영된다.
 */

import { findGimmick } from '../../config/gimmicks';
import { AP_RULES, CONTRACT_RULES, LAST_STAND_RULES, RESCUE_RULES } from '../../config/rules';
import type {
  AlertLevel,
  BattleAlert,
  BattleState,
  GimmickState,
  HunterState,
  LogEntry,
  PairState,
  RewardEntry,
  RoundPreview,
} from '../../types';
import { clearSubmissions } from '../battle';
import { evaluatePhase, nextPatternLabel } from '../enemy';
import { consumeItem, quantityOf, removeStatuses } from '../items';
import { appendLog, createLogEntry } from '../log';
import { applyGrants, clearRewards, grantFor, toEntries, type RewardGrant } from '../rewards';
import { buildRoleplayText } from '../roleplay';
import { consumeSkill, tickCooldowns } from '../skills';
import {
  applyStatus,
  constellationMaxAp,
  contractFromValue,
  injuryOf,
  shiftStage,
  tickStatuses,
} from '../status';
import { canLastStand, statusResistRounds } from '../traits';


/* ── 적용 ──────────────────────────────────────────────── */

interface StrikeResult {
  hp: number;
  lastStandUsed: boolean;
  /** 전투 불능 저항으로 버텨냈는지 */
  heldOn: boolean;
}

/**
 * 헌터에게 피해를 넣는다.
 *
 * 쓰러지는 순간 의지(WIL)가 남아 있으면 전투당 한 번 버틴다.
 * 굴림이 아니라 조건 판정이므로 예상 결과와 실제 결과가 어긋나지 않는다.
 */
function strikeHunter(hunter: HunterState, damage: number): StrikeResult {
  const raw = hunter.hp - damage;
  if (raw > 0) return { hp: raw, lastStandUsed: hunter.lastStandUsed, heldOn: false };
  if (canLastStand(hunter)) {
    return { hp: LAST_STAND_RULES.survivingHp, lastStandUsed: true, heldOn: true };
  }
  return { hp: 0, lastStandUsed: hunter.lastStandUsed, heldOn: false };
}

export function applyRound(state: BattleState, preview: RoundPreview): BattleState {
  const now = new Date();
  const entries: LogEntry[] = [];
  const alerts: BattleAlert[] = [];
  let alertSeq = 0;

  const log = (text: string, detail?: string, pairId: string | null = null) => {
    entries.push(createLogEntry({ round: preview.round, text, detail, pairId }, now));
  };
  const alert = (level: AlertLevel, title: string, message: string) => {
    alertSeq += 1;
    alerts.push({
      id: `${now.getTime()}-${alertSeq}`,
      level,
      title,
      message,
      round: preview.round,
    });
    log(`${level} — ${title}`, message);
  };

  // 이번 라운드에 지급되는 포인트. 원장에 남겨야 근거가 사라지지 않는다.
  const grants: RewardGrant[] = [];

  log(`ROUND ${String(preview.round).padStart(2, '0')} PROCESSING`);

  // 연출 로그 — 처리 전 상태를 기준으로 만들고, 운영진이 이후 수정한다
  entries.push(
    createLogEntry(
      {
        round: preview.round,
        channel: 'ROLEPLAY',
        text: buildRoleplayText(state, preview),
      },
      now,
    ),
  );

  /* 1) 페어 행동 — 행동력 · 스킬 · 현신 · 상태이상 */
  const pairs = state.pairs.map((pair) => {
    const row = preview.pairs.find((candidate) => candidate.pairId === pair.id);
    if (!row) return pair;

    if (row.hunterActionId) {
      log(
        `${pair.label} HUNTER ACTION — ${row.hunterActionLabel}`,
        `AP -${row.apSpent.hunter}${row.autoFilled.includes('HUNTER') ? ' · AUTO' : ''}`,
        pair.id,
      );
    } else if (row.skipped) {
      log(`${pair.label} HUNTER — ${row.skipReason ?? 'SKIPPED'}`, undefined, pair.id);
    }
    if (row.constellationActionId) {
      log(
        `${pair.label} CONSTELLATION AUTHORITY — ${row.constellationActionLabel}`,
        `AP -${row.apSpent.constellation}${
          row.autoFilled.includes('CONSTELLATION') ? ' · AUTO' : ''
        }`,
        pair.id,
      );
    }
    if (row.autoFilled.length > 0) {
      log(`${pair.label} AUTO CONTROL ENGAGED`, row.autoFilled.join(' / '), pair.id);
    }
    if (row.gimmickNote) {
      log(
        `${pair.label} GIMMICK ${row.gimmickCheck?.stage === 'INSIGHT' ? 'INSIGHT' : 'RESOLVE'}`,
        row.gimmickCheck
          ? `${row.gimmickNote} / 판정 ${row.gimmickCheck.total} vs ${row.gimmickCheck.dc}`
          : row.gimmickNote,
        pair.id,
      );
    }
    if (row.combo) {
      log(
        `${pair.label} PAIR COMBINATION — ${row.combo.label}`,
        `${row.combo.labelKo} · ${row.combo.effects.join(' / ')}`,
        pair.id,
      );
    }

    // 커스텀 스킬 쿨타임 · 사용 횟수
    let hunterSkills = pair.hunter.skills;
    let constellationSkills = pair.constellation.skills;
    for (const used of row.usedSkills) {
      if (used.side === 'HUNTER') {
        hunterSkills = consumeSkill(hunterSkills, used.skillId);
      } else {
        constellationSkills = consumeSkill(constellationSkills, used.skillId);
      }
      const skill =
        used.side === 'HUNTER'
          ? hunterSkills.find((candidate) => candidate.id === used.skillId)
          : constellationSkills.find((candidate) => candidate.id === used.skillId);
      if (skill) {
        log(
          `${pair.label} SKILL USED — ${skill.name}`,
          [
            skill.cooldown > 0 ? `쿨타임 ${skill.cooldown}R` : null,
            skill.remainingUses !== null ? `남은 사용 ${skill.remainingUses}회` : null,
          ]
            .filter(Boolean)
            .join(' · ') || undefined,
          pair.id,
        );
      }
    }

    // 현신 사용 횟수
    let manifestUses = pair.constellation.manifestUses;
    if (row.constellationActionId === 'const.manifest' && manifestUses.partial !== null) {
      manifestUses = { ...manifestUses, partial: Math.max(0, manifestUses.partial - 1) };
      alert('EMERGENCY', 'MANIFESTATION DETECTED', `${pair.constellation.name} 부분 현신`);
    }
    if (row.constellationActionId === 'const.manifest.full' && manifestUses.full !== null) {
      manifestUses = { ...manifestUses, full: Math.max(0, manifestUses.full - 1) };
      alert('EMERGENCY', 'FULL MANIFESTATION DETECTED', `${pair.constellation.name} 완전 현신`);
    }

    // 아이템 — 개수 차감, 행동력 회복, 상태이상 해제.
    // 가방은 사람마다 따로다 — 쓴 사람의 가방에서만 빠진다.
    let hunterBag = pair.hunter.inventory;
    let constellationBag = pair.constellation.inventory;
    let hunterStatuses = pair.hunter.statuses;
    let constellationStatuses = pair.constellation.statuses;
    let hunterApBack = 0;
    let constellationApBack = 0;

    for (const use of row.itemUses) {
      if (use.side === 'HUNTER') hunterBag = consumeItem(hunterBag, use.itemId);
      else constellationBag = consumeItem(constellationBag, use.itemId);

      const left = quantityOf(use.side === 'HUNTER' ? hunterBag : constellationBag, use.itemId);
      log(
        `${pair.label} ${use.side} ITEM USED — ${use.itemName}`,
        [`AP -${use.apCost}`, ...use.effects.slice(1), `남은 개수 ${left}`].join(' · '),
        pair.id,
      );

      if (use.side === 'HUNTER') {
        hunterApBack += use.restoreAp;
        hunterStatuses = removeStatuses(hunterStatuses, use.cureStatusIds);
      } else {
        constellationApBack += use.restoreAp;
        constellationStatuses = removeStatuses(constellationStatuses, use.cureStatusIds);
      }
      for (const defId of use.cureStatusIds) {
        log(`${pair.label} STATUS CLEARED — ${defId}`, use.itemName, pair.id);
      }
    }

    // 자기 페어에게 걸리는 상태이상
    for (const application of row.appliedStatuses) {
      if (application.holder === 'HUNTER' && application.ownerId === pair.id) {
        hunterStatuses = applyStatus(
          hunterStatuses,
          application.defId,
          row.pairLabel,
          application.scale,
          application.durationBonus ?? 0,
        );
        log(`${pair.label} STATUS APPLIED — ${application.label}`, 'HUNTER', pair.id);
      } else if (application.holder === 'CONSTELLATION') {
        constellationStatuses = applyStatus(
          constellationStatuses,
          application.defId,
          row.pairLabel,
          application.scale,
        );
        log(`${pair.label} STATUS APPLIED — ${application.label}`, 'CONSTELLATION', pair.id);
      }
    }

    // 계약 안정도 — 공명 회복과 현신 반동이 여기서 정산된다
    const contract = contractFromValue(pair.contract.value + row.contractDelta);
    if (row.contractDelta !== 0) {
      log(
        `${pair.label} CONTRACT ${pair.contract.value} > ${contract.value}`,
        `${row.contractDelta > 0 ? '+' : ''}${row.contractDelta} · ${contract.stage}`,
        pair.id,
      );
    }
    if (contract.stage !== pair.contract.stage) {
      alert(
        contract.value < pair.contract.value ? 'CRITICAL' : 'WARNING',
        'CONTRACT SHIFT',
        `${pair.label} 계약 상태 ${pair.contract.stage} → ${contract.stage}`,
      );
    }

    // 성좌 존재 상태 — 계약 붕괴로 내려가고, 성유물로 되돌아온다
    const stage = row.stageDrop === 0 ? pair.constellation.stage : shiftStage(pair.constellation.stage, row.stageDrop);
    if (stage !== pair.constellation.stage) {
      alert(
        row.stageDrop > 0 ? 'CRITICAL' : 'WARNING',
        row.stageDrop > 0 ? 'CONSTELLATION DESTABILIZED' : 'CONSTELLATION STABILIZED',
        `${pair.constellation.name} ${pair.constellation.stage} → ${stage}`,
      );
    }

    return {
      ...pair,
      contract,
      hunter: {
        ...pair.hunter,
        ap: Math.min(
          pair.hunter.maxAp,
          Math.max(0, pair.hunter.ap - row.apSpent.hunter) + hunterApBack,
        ),
        skills: hunterSkills,
        statuses: hunterStatuses,
        inventory: hunterBag,
      },
      constellation: {
        ...pair.constellation,
        stage,
        inventory: constellationBag,
        ap: Math.min(
          constellationMaxAp(pair.constellation.maxAp, stage),
          Math.max(0, pair.constellation.ap - row.apSpent.constellation) + constellationApBack,
        ),
        skills: constellationSkills,
        statuses: constellationStatuses,
        manifestUses,
      },
      // 예지 권역의 계시는 공략조 전체가 함께 본다
      patternRevealed: row.revealPattern || preview.sharedReveal,
    };
  });

  /* 다른 페어에게 걸리는 상태이상 (보호) */
  for (const row of preview.pairs) {
    for (const application of row.appliedStatuses) {
      if (application.holder !== 'HUNTER' || application.ownerId === row.pairId) continue;
      const index = pairs.findIndex((pair) => pair.id === application.ownerId);
      if (index < 0) continue;
      pairs[index] = {
        ...pairs[index],
        hunter: {
          ...pairs[index].hunter,
          statuses: applyStatus(
            pairs[index].hunter.statuses,
            application.defId,
            row.pairLabel,
            application.scale,
            application.durationBonus ?? 0,
          ),
        },
      };
      log(
        `${pairs[index].label} STATUS APPLIED — ${application.label}`,
        `${row.pairLabel} 보호`,
        pairs[index].id,
      );
    }
  }

  /* 2) 구조 */
  for (const row of preview.pairs) {
    if (!row.rescue) continue;
    const index = pairs.findIndex((pair) => pair.id === row.rescue?.targetPairId);
    if (index < 0 || pairs[index].hunter.hp > 0) continue;

    let statuses = pairs[index].hunter.statuses;
    for (const defId of RESCUE_RULES.applyStatusIds) {
      statuses = applyStatus(statuses, defId, row.pairLabel);
    }
    pairs[index] = {
      ...pairs[index],
      hunter: { ...pairs[index].hunter, hp: row.rescue.restoredHp, statuses },
    };
    alert(
      'WARNING',
      'HUNTER RECOVERED',
      `${row.pairLabel} → ${row.rescue.targetLabel} 구조 완료 (HP ${row.rescue.restoredHp})`,
    );
  }

  /* 2-1) 페어가 이번 라운드에 확보한 포인트 (구조 등) */
  for (const row of preview.pairs) {
    for (const reward of row.rewards) {
      grants.push({ pairId: row.pairId, reason: reward.reason, label: reward.label, points: reward.points });
    }
  }

  /* 2-2) 회복 — 회복 스킬과 아이템은 구조와 별도로 정산한다 */
  for (const row of preview.pairs) {
    for (const heal of row.heals) {
      const index = pairs.findIndex((pair) => pair.id === heal.targetPairId);
      if (index < 0) continue;

      const target = pairs[index];
      const reviving = row.itemUses.some((use) => use.revive && use.targetPairId === target.id);

      // 전투 불능인 대상은 부활 효과가 있는 아이템만 되살릴 수 있다.
      if (target.hunter.hp <= 0 && !reviving) {
        log(`${target.label} HEAL FAILED — 전투 불능`, heal.sourceLabel, target.id);
        continue;
      }

      const hp = Math.min(target.hunter.maxHp, Math.max(0, target.hunter.hp) + heal.amount);
      log(
        `${target.label} HEAL ${target.hunter.hp} > ${hp}`,
        `${heal.sourceLabel} · +${heal.amount}`,
        target.id,
      );
      pairs[index] = { ...target, hunter: { ...target.hunter, hp } };

      if (reviving) {
        alert('WARNING', 'HUNTER RECOVERED', `${row.pairLabel} → ${target.label} 아이템으로 복귀`);
      }
    }
  }

  /* 3) 적 상태이상 + 피해 */
  const damageByEnemy = new Map<string, number>();
  for (const row of preview.pairs) {
    if (!row.targetEnemyId) continue;
    const total = row.damageToEnemy + row.itemDamageToEnemy;
    if (total <= 0) continue;
    damageByEnemy.set(row.targetEnemyId, (damageByEnemy.get(row.targetEnemyId) ?? 0) + total);
    log(`${row.pairLabel} DAMAGE ${total}`, row.notes.join(' / '), row.pairId);
  }

  let enemies = state.enemies.map((enemy) => {
    let statuses = enemy.statuses;
    for (const row of preview.pairs) {
      for (const application of row.appliedStatuses) {
        if (application.holder !== 'ENEMY' || application.ownerId !== enemy.id) continue;
        statuses = applyStatus(statuses, application.defId, row.pairLabel, application.scale);
        log(`TARGET STATUS APPLIED — ${application.label}`, `${enemy.name} ← ${row.pairLabel}`);
      }
    }
    for (const row of preview.enemies) {
      if (row.enemyId !== enemy.id) continue;
      for (const application of row.appliedStatuses) {
        if (application.holder !== 'ENEMY') continue;
        statuses = applyStatus(statuses, application.defId, enemy.name, application.scale);
        log(`TARGET STATUS APPLIED — ${application.label}`, `${enemy.name} 자기 강화`);
      }
    }

    const damage = damageByEnemy.get(enemy.id) ?? 0;
    const hp = Math.max(0, enemy.hp - damage);
    if (damage > 0) {
      log(`TARGET ${enemy.name} HP ${enemy.hp} > ${hp}`, `TOTAL DAMAGE ${damage}`);
      if (hp === 0) log(`TARGET DOWN — ${enemy.name}`);
    }

    return { ...enemy, hp, statuses };
  });

  /* 4) 적 행동 */
  for (const row of preview.enemies) {
    const enemyStillAlive = enemies.find((enemy) => enemy.id === row.enemyId);
    if (enemyStillAlive && enemyStillAlive.hp === 0) {
      if (row.damageToHunter > 0 || row.telegraph) {
        log(`${row.enemyName} ACTION CANCELLED`, '처치로 행동 취소');
      }
      continue;
    }

    if (row.blocked) {
      log(`${row.enemyName} ACTION BLOCKED`, row.notes.join(' / '));
      continue;
    }

    if (row.telegraph) {
      const index = enemies.findIndex((enemy) => enemy.id === row.enemyId);
      if (index >= 0) {
        enemies[index] = { ...enemies[index], telegraph: row.telegraph };
      }
      alert('TOWER', 'TOWER ALERT', `${row.enemyName} — ${row.telegraph.message}`);
      continue;
    }

    if (row.aoe && row.hits.length > 0) {
      alert('WARNING', 'AREA ATTACK', `${row.enemyName} — ${row.pattern}`);
    }

    for (const hit of row.hits) {
      const index = pairs.findIndex((pair) => pair.id === hit.pairId);
      if (index < 0 || hit.damage <= 0) continue;

      const target = pairs[index];
      if (target.hunter.hp <= 0) continue;

      const strike = strikeHunter(target.hunter, hit.damage);
      log(
        `${row.enemyName} → ${target.label} DAMAGE ${hit.damage}`,
        `${row.pattern} / ${row.notes.join(' / ')}`,
        target.id,
      );
      log(`${target.label} HUNTER HP ${target.hunter.hp} > ${strike.hp}`, undefined, target.id);

      let statuses = target.hunter.statuses;
      for (const application of row.appliedStatuses) {
        if (application.holder !== 'HUNTER' || application.ownerId !== target.id) continue;
        statuses = applyStatus(
          statuses,
          application.defId,
          row.enemyName,
          application.scale,
          application.durationBonus ?? 0,
        );
        log(`${target.label} STATUS APPLIED — ${application.label}`, row.enemyName, target.id);
      }

      pairs[index] = {
        ...target,
        hunter: { ...target.hunter, hp: strike.hp, statuses, lastStandUsed: strike.lastStandUsed },
      };

      if (strike.heldOn) {
        alert(
          'CRITICAL',
          'HUNTER HELD ON',
          `${target.label} ${target.hunter.name} 의지로 버텨냈습니다 (HP ${strike.hp})`,
        );
      } else if (strike.hp === 0) {
        alert('CRITICAL', 'HUNTER DOWN', `${target.label} ${target.hunter.name} 전투 불능`);
      } else {
        const injury = injuryOf(pairs[index].hunter);
        log(`${target.label} STATUS ${injury.label}`, injury.labelKo, target.id);
      }
    }

    // 예고가 해소되었으면 비운다
    const index = enemies.findIndex((enemy) => enemy.id === row.enemyId);
    if (index >= 0 && enemies[index].telegraph && enemies[index].telegraph!.roundsLeft <= 0) {
      enemies[index] = { ...enemies[index], telegraph: null };
    }
  }

  /* 5) 지속 피해 */
  for (const tick of preview.statusTicks) {
    if (tick.holder === 'ENEMY') {
      const index = enemies.findIndex((enemy) => enemy.id === tick.ownerId);
      if (index < 0 || enemies[index].hp <= 0) continue;
      const hp = Math.max(0, enemies[index].hp - tick.amount);
      log(`${tick.label} TICK — ${tick.ownerLabel} ${enemies[index].hp} > ${hp}`, `-${tick.amount}`);
      enemies[index] = { ...enemies[index], hp };
      if (hp === 0) log(`TARGET DOWN — ${enemies[index].name}`);
      continue;
    }

    const index = pairs.findIndex((pair) => pair.id === tick.ownerId);
    if (index < 0 || pairs[index].hunter.hp <= 0) continue;
    const strike = strikeHunter(pairs[index].hunter, tick.amount);
    log(
      `${tick.label} TICK — ${tick.ownerLabel} ${pairs[index].hunter.hp} > ${strike.hp}`,
      `-${tick.amount}`,
      pairs[index].id,
    );
    pairs[index] = {
      ...pairs[index],
      hunter: { ...pairs[index].hunter, hp: strike.hp, lastStandUsed: strike.lastStandUsed },
    };
    if (strike.heldOn) {
      alert('CRITICAL', 'HUNTER HELD ON', `${pairs[index].label} 지속 피해를 의지로 버텨냈습니다`);
    } else if (strike.hp === 0) {
      alert('CRITICAL', 'HUNTER DOWN', `${pairs[index].label} 지속 피해로 전투 불능`);
    }
  }

  /* 6) 기믹 정산 */
  let gimmick: GimmickState | null = state.gimmick;

  // 파악에 성공한 페어가 있으면 장치 정보가 공략조 전체에 공유된다
  if (gimmick && gimmick.status === 'ACTIVE') {
    const identifiers = preview.pairs.filter((row) => row.gimmickIdentified);
    if (identifiers.length > 0 && !gimmick.identified) {
      gimmick = {
        ...gimmick,
        identified: true,
        identifiedBy: [...gimmick.identifiedBy, ...identifiers.map((row) => row.pairLabel)],
      };
      alert(
        'WARNING',
        'GIMMICK IDENTIFIED',
        `${identifiers.map((row) => row.pairLabel).join(', ')} — ${findGimmick(gimmick.defId)?.insightReveal ?? '장치를 파악했습니다.'}`,
      );
    } else if (identifiers.length > 0) {
      for (const row of identifiers) {
        log(`GIMMICK INSIGHT — ${row.pairLabel} (이미 파악됨)`, undefined, row.pairId);
      }
    }
  }

  if (gimmick && gimmick.status === 'ACTIVE') {
    const gained = preview.pairs.reduce((sum, row) => sum + row.gimmickProgress, 0);
    const progress = gimmick.progress + gained;
    const roundsLeft = gimmick.roundsLeft === null ? null : gimmick.roundsLeft - 1;
    const def = findGimmick(gimmick.defId);

    if (gained > 0) {
      log(`GIMMICK PROGRESS — ${gimmick.label} ${progress}/${gimmick.required}`, `+${gained}`);
    }

    if (progress >= gimmick.required) {
      gimmick = { ...gimmick, progress, roundsLeft, status: 'CLEARED' };
      alert('WARNING', 'GIMMICK CLEARED', def?.onClear.message ?? `${gimmick.label} 해제`);

      // 장치를 실제로 다룬 페어에게 지급한다. 아무도 없으면(운영진 처리) 생존 페어에게 나눈다.
      const contributors = preview.pairs.filter((row) => row.gimmickProgress > 0);
      const receivers =
        contributors.length > 0
          ? contributors.map((row) => row.pairId)
          : pairs.filter((pair) => pair.hunter.hp > 0).map((pair) => pair.id);
      for (const pairId of receivers) {
        grants.push(grantFor(pairId, 'HIDDEN_GIMMICK'));
      }

      // 장치 해제는 계약에도 좋게 작용한다
      for (let index = 0; index < pairs.length; index += 1) {
        if (!receivers.includes(pairs[index].id)) continue;
        pairs[index] = {
          ...pairs[index],
          contract: contractFromValue(
            pairs[index].contract.value + CONTRACT_RULES.events.gimmickCleared,
          ),
        };
      }

      if (def) {
        enemies = enemies.map((enemy) => {
          if (!enemy.boss || enemy.hp <= 0) return enemy;
          let statuses = enemy.statuses;
          for (const defId of def.onClear.applyStatusIds ?? []) {
            statuses = applyStatus(statuses, defId, gimmick!.label);
          }
          const hp = Math.max(0, enemy.hp - (def.onClear.damage ?? 0));
          if (def.onClear.damage) {
            log(`GIMMICK DAMAGE — ${enemy.name} ${enemy.hp} > ${hp}`, `-${def.onClear.damage}`);
          }
          // 예고 중인 즉사급 패턴은 기믹 해제로 무력화된다
          return { ...enemy, hp, statuses, telegraph: null };
        });
      }
    } else if (roundsLeft !== null && roundsLeft <= 0) {
      gimmick = { ...gimmick, progress, roundsLeft: 0, status: 'FAILED' };
      alert('EMERGENCY', 'GIMMICK FAILED', def?.onFail.message ?? `${gimmick.label} 해제 실패`);

      if (def?.onFail.damageToAll) {
        for (let index = 0; index < pairs.length; index += 1) {
          if (pairs[index].hunter.hp <= 0) continue;
          const strike = strikeHunter(pairs[index].hunter, def.onFail.damageToAll);
          let statuses = pairs[index].hunter.statuses;
          const resist = statusResistRounds(pairs[index].hunter);
          for (const defId of def.onFail.applyStatusIds ?? []) {
            statuses = applyStatus(statuses, defId, gimmick.label, 1, -resist);
          }
          log(
            `GIMMICK BACKLASH — ${pairs[index].label} ${pairs[index].hunter.hp} > ${strike.hp}`,
            `-${def.onFail.damageToAll}`,
            pairs[index].id,
          );
          pairs[index] = {
            ...pairs[index],
            hunter: {
              ...pairs[index].hunter,
              hp: strike.hp,
              statuses,
              lastStandUsed: strike.lastStandUsed,
            },
          };
        }
      }
    } else {
      gimmick = { ...gimmick, progress, roundsLeft };
    }
  }

  /* 7) 보스 페이즈 판정 */
  enemies = enemies.map((enemy) => {
    if (!enemy.boss || enemy.hp <= 0) return enemy;
    const phase = evaluatePhase(enemy);
    if (!phase.changed) return enemy;
    alert('WARNING', 'BOSS PHASE CHANGE', `${enemy.name} — ${phase.label}`);
    return { ...enemy, phase: phase.phase };
  });

  /* 8) 종료 판정 */
  const allEnemiesDown = enemies.every((enemy) => enemy.hp === 0);
  const allHuntersDown = pairs.every((pair) => pair.hunter.hp === 0);

  /**
   * 포인트 정산.
   * 원장에 항목을 남기고 페어 보유량에 더한다 — 두 곳이 어긋나면 근거를 잃는다.
   */
  const settleRewards = (targetPairs: PairState[]): { pairs: PairState[]; rewards: RewardEntry[] } => {
    if (grants.length === 0) return { pairs: targetPairs, rewards: state.rewards };
    for (const grant of grants) {
      const label = targetPairs.find((pair) => pair.id === grant.pairId)?.label ?? grant.pairId;
      log(`${label} POINTS +${grant.points}`, grant.label, grant.pairId);
    }
    return {
      pairs: applyGrants(targetPairs, grants),
      rewards: [...state.rewards, ...toEntries(grants, preview.round, now.getTime())],
    };
  };

  if (allEnemiesDown || allHuntersDown) {
    log(allEnemiesDown ? 'OPERATION CLEARED' : 'OPERATION FAILED — ALL HUNTERS DOWN');
    const status = allEnemiesDown ? 'CLEARED' : 'FAILED';

    // 클리어 보상은 종료가 확정된 다음에만 지급한다
    grants.push(...clearRewards({ ...state, pairs, enemies, status }));

    const settled = settleRewards(pairs);
    return {
      ...state,
      pairs: settled.pairs,
      rewards: settled.rewards,
      enemies,
      gimmick,
      status,
      log: appendLog(state.log, entries),
      alerts: [...state.alerts, ...alerts].slice(-12),
    };
  }

  /* 9) 라운드 종료 — 상태이상 · 쿨타임 · 예고 · 행동력 */
  const nextRound = state.round + 1;

  enemies = enemies.map((enemy) => {
    const ticked = tickStatuses(enemy.statuses);
    for (const expired of ticked.expired) {
      log(`STATUS EXPIRED — ${expired.label}`, enemy.name);
    }
    const telegraph = enemy.telegraph
      ? { ...enemy.telegraph, roundsLeft: enemy.telegraph.roundsLeft - 1 }
      : null;
    const next = { ...enemy, statuses: ticked.statuses, telegraph };
    return { ...next, nextPattern: nextPatternLabel(next, nextRound) };
  });

  const recovered = pairs.map((pair) => {
    const hunterTicked = tickStatuses(pair.hunter.statuses);
    const constellationTicked = tickStatuses(pair.constellation.statuses);
    for (const expired of [...hunterTicked.expired, ...constellationTicked.expired]) {
      log(`STATUS EXPIRED — ${expired.label}`, pair.label, pair.id);
    }

    const constMax = constellationMaxAp(pair.constellation.maxAp, pair.constellation.stage);
    return {
      ...pair,
      hunter: {
        ...pair.hunter,
        ap: Math.min(pair.hunter.maxAp, pair.hunter.ap + AP_RULES.recoveryPerRound),
        statuses: hunterTicked.statuses,
        skills: tickCooldowns(pair.hunter.skills),
      },
      constellation: {
        ...pair.constellation,
        ap: Math.min(constMax, pair.constellation.ap + AP_RULES.recoveryPerRound),
        statuses: constellationTicked.statuses,
        skills: tickCooldowns(pair.constellation.skills),
      },
    };
  });

  log(`ROUND ${String(nextRound).padStart(2, '0')} START`, `AP +${AP_RULES.recoveryPerRound}`);

  const settled = settleRewards(recovered);

  return {
    ...state,
    round: nextRound,
    pairs: clearSubmissions(settled.pairs, enemies),
    rewards: settled.rewards,
    enemies,
    gimmick,
    log: appendLog(state.log, entries),
    alerts: [...state.alerts, ...alerts].slice(-12),
  };
}

