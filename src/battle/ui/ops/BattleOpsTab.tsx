/**
 * 전투 진행 탭 — 전투가 열려 있을 때의 작전실.
 *
 * 이 화면이 작전실의 심장이다. 제출을 지켜보고, 라운드를 계산해 미리 보고,
 * 수치를 손으로 고친 뒤 확정한다.
 *
 * **자동 판정은 운영진보다 위가 아니다.** 계산 결과(preview)는 확정 전까지
 * 전부 손으로 덮어쓸 수 있고, 확정한 뒤에도 한 번은 되돌릴 수 있다.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';

import { GIMMICK_CHECK, findGimmick } from '../../config/gimmicks';
import { ITEM_DEFINITIONS, describeItem, findItem } from '../../config/items';
import { manualRewards } from '../../config/rewards';
import { CONSTELLATION_STAGES, CONTRACT_STAGES } from '../../config/rules';
import * as admin from '../../engine/admin';
import { pairReady } from '../../engine/battle';
import { describePhaseBands, nextPatternAdmin } from '../../engine/enemy';
import { availableStage, gimmickBrief } from '../../engine/gimmick';
import { bagOf } from '../../engine/items';
import { newUuid } from '../../engine/id';
import { rewardSideLabel } from '../../engine/rewards';
import { actionAvailability, applyRound, previewRound } from '../../engine/round';
import { actionsFor } from '../../engine/skills';
import { injuryOf, statusViews } from '../../engine/status';
import AttackEditor from '../AttackEditor';
import Collapsible from '../Collapsible';
import { ActorSheet, sideLabel } from '../SheetView';
import { useOps } from './OpsContext';
import { Bar, NumberField, StatusEditor, battleTally, confirmed } from './shared';
import type {
  ActorSide,
  BattleState,
  CharacterSheet,
  ConstellationStage,
  ContractStage,
  EnemyState,
  PairBond,
  RoundPreview,
} from '../../types';

type PairFilter = 'ALL' | 'GOVERNMENT' | 'GUILD' | 'INJURED' | 'DOWN' | 'NOT_SUBMITTED';

export default function BattleOpsTab({
  battle,
  update,
  setBattle,
  preview,
  setPreview,
  activeBonds,
  sheetOf,
  operatorHandle,
  chatRef,
  archiveBattle,
  closeBattle,
}: {
  battle: BattleState;
  update: (next: BattleState) => void;
  setBattle: (next: BattleState) => void;
  preview: RoundPreview | null;
  setPreview: (next: RoundPreview | null) => void;
  activeBonds: PairBond[];
  sheetOf: (accountId: string | null) => CharacterSheet | null;
  operatorHandle: string;
  /** 채팅 칸은 어느 탭에서든 보이므로 본체가 들고 있다 — 여기서는 뛰어갈 자리로만 쓴다 */
  chatRef: RefObject<HTMLDivElement | null>;
  archiveBattle: (state: BattleState, silent?: boolean) => Promise<void>;
  closeBattle: () => void;
}) {
  const { storage, guard, setMessage } = useOps();
  const [filter, setFilter] = useState<PairFilter>('ALL');
  /** 소지금 지급 대상 — 페어 id 마다 기억한다. BOTH 는 두 사람이 각자 받는다. */
  const [rewardSide, setRewardSide] = useState<Record<string, 'BOTH' | ActorSide>>({});
  /** 페어가 늘면 카드 하나가 화면 한 장을 먹는다 — 기본은 접어 둔다 */
  const [monitorDense, setMonitorDense] = useState(true);
  /** 일괄 조작 대상 페어 */
  const [bulkPairs, setBulkPairs] = useState<string[]>([]);
  /** 직전 확정을 한 번만 되돌린다 — 손으로 수치를 복원하는 일을 없앤다 */
  const [undoBattle, setUndoBattle] = useState<BattleState | null>(null);
  const processRef = useRef<HTMLElement>(null);

  /** 전투가 바뀌면 되돌리기와 일괄 선택은 의미가 없다 */
  useEffect(() => {
    setUndoBattle(null);
    setBulkPairs([]);
  }, [battle?.id]);

  const { injured, down, readyCount, waitingSides } = battleTally(battle);

  const filteredPairs = (battle?.pairs ?? []).filter((pair) => {
    switch (filter) {
      case 'GOVERNMENT':
        return pair.affiliation === 'GOVERNMENT';
      case 'GUILD':
        return pair.affiliation === 'PRIVATE_GUILD';
      case 'INJURED':
        return pair.hunter.hp > 0 && pair.hunter.hp < pair.hunter.maxHp * 0.7;
      case 'DOWN':
        return pair.hunter.hp <= 0;
      case 'NOT_SUBMITTED':
        return waitingSides.some((row) => row.pairId === pair.id);
      default:
        return true;
    }
  });

  const patchPreviewPair = (pairId: string, patch: Partial<RoundPreview['pairs'][number]>) => {
    if (!preview) return;
    setPreview({
      ...preview,
      pairs: preview.pairs.map((row) => (row.pairId === pairId ? { ...row, ...patch } : row)),
    });
  };

  const patchPreviewEnemy = (enemyId: string, damage: number) => {
    if (!preview) return;
    setPreview({
      ...preview,
      enemies: preview.enemies.map((row) => {
        if (row.enemyId !== enemyId) return row;
        const ratio = row.damageToHunter > 0 ? damage / row.damageToHunter : 0;
        return {
          ...row,
          damageToHunter: damage,
          hits: row.hits.map((hit) => ({
            ...hit,
            damage: row.hits.length === 1 ? damage : Math.round(hit.damage * ratio),
          })),
        };
      }),
    });
  };


  /** 그 페어가 지금 겨누고 있는 적 — 참가자 시점 미리보기에 쓴다 */
  const peekTarget = (pair: BattleState['pairs'][number]): EnemyState | null => {
    if (!battle) return null;
    return (
      battle.enemies.find((row) => row.id === pair.submission.targetEnemyId) ??
      battle.enemies[0] ??
      null
    );
  };

  const jumpTo = (ref: { current: HTMLElement | null }) =>
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  /** 라운드 계산 — 어디서 눌러도 결과표 앞으로 데려간다 */
  const computeRound = () => {
    if (!battle) return;
    setPreview(previewRound(battle));
    window.requestAnimationFrame(() => jumpTo(processRef));
  };

  /** 결과 확정 — 도크와 표에서 같은 동작을 쓴다 */
  const applyPreview = () => {
    if (!battle || !preview) return;
    // 확정 직전 상태를 한 장 남긴다. 잘못 넣은 수치를 손으로 복원하지 않게 한다.
    setUndoBattle(battle);
    setBattle(applyRound(battle, preview));
    setPreview(null);
    setMessage(
      `ROUND ${battle.round} 결과를 확정했습니다. 연출 로그가 만들어졌고 참가자 화면이 갱신됩니다.`,
    );
  };

  /** 직전 확정을 되돌린다 — 한 단계만 남는다 */
  const undoApply = () => {
    if (!undoBattle) return;
    if (
      !confirmed(
        `ROUND ${undoBattle.round} 확정을 되돌립니다. 그 뒤에 손으로 고친 수치도 함께 사라집니다.`,
      )
    ) {
      return;
    }
    setBattle(undoBattle);
    setPreview(null);
    setUndoBattle(null);
    setMessage(`ROUND ${undoBattle.round} 직전 상태로 되돌렸습니다.`);
  };

  /**
   * 선택한 페어에 같은 조작을 한 번에 건다.
   * 페어가 여섯 조만 되어도 하나씩 여는 것이 일이 된다.
   */
  const runBulk = (label: string, step: (state: BattleState, pairId: string) => BattleState) => {
    if (!battle || bulkPairs.length === 0) return;
    let next = battle;
    for (const pairId of bulkPairs) next = step(next, pairId);
    update(next);
    setMessage(`${bulkPairs.length}개 페어 — ${label}`);
  };

  /** 그 페어의 모든 상태이상을 걷어낸다 */
  const clearStatuses = (state: BattleState, pairId: string): BattleState => {
    const pair = state.pairs.find((row) => row.id === pairId);
    if (!pair) return state;
    let next = state;
    for (const status of pair.hunter.statuses) {
      next = admin.revokeStatus(next, 'HUNTER', pairId, status.defId);
    }
    for (const status of pair.constellation.statuses) {
      next = admin.revokeStatus(next, 'CONSTELLATION', pairId, status.defId);
    }
    return next;
  };

  const callWaiting = () => {
    if (!battle || waitingSides.length === 0) return;
    const names = waitingSides
      .map((row) => `${row.label} ${row.side === 'HUNTER' ? '헌터' : '성좌'}`)
      .join(' · ');
    void guard(async () => {
      await storage.postMessage({
        id: newUuid(),
        channel: battle.id,
        authorId: operatorHandle,
        authorName: '관리국',
        role: 'OPERATOR',
        side: null,
        kind: 'OOC',
        body: `[제출 요청] ROUND ${battle.round} — ${names} 의 제출을 기다립니다.`,
        dice: null,
        at: new Date().toISOString(),
      });
      setMessage(`채널에 제출 요청을 올렸습니다 (${waitingSides.length}건).`);
    });
  };

  return (
      <>
        {/* 전투 제어 */}
        <section className="panel session">
          <div className="session-row">
            <span className={`tag ${battle.status === 'ENGAGED' ? 'ok' : 'warn'}`}>
              {battle.status}
            </span>
            <NumberField
              label="ROUND"
              value={battle.round}
              min={1}
              onCommit={(value) => update(admin.setRound(battle, value))}
            />
            <div className="btn-row">
              <button
                type="button"
                className="ctl small"
                onClick={() => {
                  if (confirmed('이 전투를 클리어로 종료합니다. 참가자는 더 이상 제출할 수 없습니다.')) {
                    update(admin.setBattleStatus(battle, 'CLEARED'));
                  }
                }}
              >
                종료 · 클리어
              </button>
              <button
                type="button"
                className="ctl small"
                onClick={() => {
                  if (confirmed('이 전투를 실패로 종료합니다. 참가자는 더 이상 제출할 수 없습니다.')) {
                    update(admin.setBattleStatus(battle, 'FAILED'));
                  }
                }}
              >
                종료 · 실패
              </button>
              <button
                type="button"
                className="ctl small"
                title="모든 페어의 이번 라운드 제출을 지웁니다"
                onClick={() => {
                  if (confirmed('모든 페어의 이번 라운드 제출을 지웁니다. 참가자가 다시 골라야 합니다.')) {
                    update(admin.resetAllSubmissions(battle));
                  }
                }}
              >
                제출 초기화
              </button>
              <button
                type="button"
                className="ctl small"
                title="전투는 서버에 남습니다. 이 화면에서만 닫습니다."
                onClick={closeBattle}
              >
                전투 닫기
              </button>
            </div>
          </div>
        </section>

        {/* 이탈자 */}
        {waitingSides.length > 0 && (
          <section className="panel desertion">
            <div className="process-head">
              <h2 className="panel-title">미제출 · {waitingSides.length}</h2>
              <div className="btn-row">
                <button type="button" className="ctl small" onClick={callWaiting}>
                  채널로 호출
                </button>
                <button
                  type="button"
                  className="ctl primary"
                  onClick={() => update(admin.forceAutoForUnsubmitted(battle))}
                >
                  전원 자동 위임
                </button>
              </div>
            </div>
            <div className="desertion-list">
              {waitingSides.map((row) => (
                <div className="desertion-row" key={`${row.pairId}-${row.side}`}>
                  <b>{row.label}</b>
                  <span className={`tag ${row.side === 'HUNTER' ? 'blue' : 'gold'}`}>
                    {row.side === 'HUNTER' ? '헌터' : '성좌'}
                  </span>
                  <button
                    type="button"
                    className="ctl small"
                    onClick={() => update(admin.forceControl(battle, row.pairId, row.side, 'AUTO'))}
                  >
                    강제 AUTO
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 적 상황판 */}
        <section className="panel">
          <h2 className="panel-title">TARGET STATUS</h2>
          <div className="target-grid">
            {battle.enemies.map((enemy) => (
              <article key={enemy.id} className={`target ${enemy.boss ? 'boss' : ''}`}>
                <div className="target-head">
                  <span className="grade">{enemy.grade}</span>
                  <b>{enemy.name}</b>
                </div>
                <Bar
                  value={enemy.hp}
                  max={enemy.maxHp}
                  tone={enemy.hp / enemy.maxHp < 0.3 ? 'critical' : 'danger'}
                />
                <div className="stat-strip">
                  <span>
                    <i>HP</i>
                    <b className="num">
                      {enemy.hp}
                      <small>/{enemy.maxHp}</small>
                    </b>
                  </span>
                  <span>
                    <i>ATK</i>
                    <b className="num">{enemy.attack}</b>
                  </span>
                  <span>
                    <i>DEF</i>
                    <b className="num">{enemy.defense}</b>
                  </span>
                  <span>
                    <i>PHASE</i>
                    <b className="num">
                      {enemy.phase}
                      <small>/{enemy.maxPhase}</small>
                    </b>
                  </span>
                </div>
                <StatusEditor
                  holder="ENEMY"
                  ownerId={enemy.id}
                  statuses={enemy.statuses}
                  onGrant={(h, o, d) => update(admin.grantStatus(battle, h, o, d))}
                  onRevoke={(h, o, d) => update(admin.revokeStatus(battle, h, o, d))}
                />
                {/* 접지 않고 바로 깎는다 — 전투 중 가장 자주 하는 조작이다 */}
                <div className="quick-hp">
                  <span className="field-label">HP</span>
                  {[-20, -10, -5, 5, 10].map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      className="ctl small"
                      onClick={() =>
                        update(admin.setEnemyHp(battle, enemy.id, enemy.hp + delta))
                      }
                    >
                      {delta > 0 ? `+${delta}` : delta}
                    </button>
                  ))}
                  <NumberField
                    label=""
                    value={enemy.hp}
                    max={enemy.maxHp}
                    onCommit={(value) => update(admin.setEnemyHp(battle, enemy.id, value))}
                  />
                  <button
                    type="button"
                    className="ctl small"
                    title="이 적을 쓰러뜨립니다"
                    onClick={() => update(admin.setEnemyHp(battle, enemy.id, 0))}
                  >
                    처치
                  </button>
                </div>

                <div className="admin-only">
                  <span className="field-label">운영진 전용 · 다음 패턴</span>
                  <b className="gold">{nextPatternAdmin(enemy, battle.round)}</b>
                  {enemy.telegraph && (
                    <>
                      <span className="tag critical">
                        예고 {Math.max(0, enemy.telegraph.roundsLeft)}R
                      </span>
                      <button
                        type="button"
                        className="ctl small"
                        onClick={() => update(admin.clearTelegraph(battle, enemy.id))}
                      >
                        취소
                      </button>
                    </>
                  )}
                </div>
                <Collapsible
                  label={`보스 패턴 — 공격 ${(enemy.attacks ?? []).length}개 · ${describePhaseBands(
                    enemy,
                  )}`}
                >
                  <AttackEditor
                    attacks={enemy.attacks ?? []}
                    maxPhase={enemy.maxPhase}
                    enemyAttack={enemy.attack}
                    maxHp={enemy.maxHp}
                    phaseCutoffs={enemy.phaseCutoffs ?? []}
                    patternSetId={enemy.patternSetId}
                    onChange={(attacks) =>
                      update(admin.setEnemyAttacks(battle, enemy.id, attacks))
                    }
                    onPhaseCutoffs={(phaseCutoffs) =>
                      update(admin.setEnemyPhaseRules(battle, enemy.id, { phaseCutoffs }))
                    }
                  />
                </Collapsible>

                <Collapsible label="수치 편집">
                  <div className="admin-grid">
                    <NumberField
                      label="HP"
                      value={enemy.hp}
                      max={enemy.maxHp}
                      onCommit={(value) => update(admin.setEnemyHp(battle, enemy.id, value))}
                    />
                    <NumberField
                      label="MAX HP"
                      value={enemy.maxHp}
                      min={1}
                      onCommit={(value) =>
                        update(admin.setEnemyStats(battle, enemy.id, { maxHp: value }))
                      }
                    />
                    <NumberField
                      label="ATK"
                      value={enemy.attack}
                      onCommit={(value) =>
                        update(admin.setEnemyStats(battle, enemy.id, { attack: value }))
                      }
                    />
                    <NumberField
                      label="DEF"
                      value={enemy.defense}
                      onCommit={(value) =>
                        update(admin.setEnemyStats(battle, enemy.id, { defense: value }))
                      }
                    />
                    <NumberField
                      label="PHASE"
                      value={enemy.phase}
                      min={1}
                      max={enemy.maxPhase}
                      onCommit={(value) => update(admin.setEnemyPhase(battle, enemy.id, value))}
                    />
                    <NumberField
                      label="MAX PHASE"
                      value={enemy.maxPhase}
                      min={1}
                      max={5}
                      onCommit={(value) =>
                        update(admin.setEnemyPhaseRules(battle, enemy.id, { maxPhase: value }))
                      }
                    />
                  </div>
                </Collapsible>
              </article>
            ))}
          </div>

          {battle.gimmick && (
            <div className="admin-gimmick">
              <span className="field-label">기믹</span>
              <b>{battle.gimmick.labelKo}</b>
              <span className="num">
                {battle.gimmick.progress} / {battle.gimmick.required}
              </span>
              <span
                className={`tag ${
                  battle.gimmick.status === 'CLEARED'
                    ? 'ok'
                    : battle.gimmick.status === 'FAILED'
                      ? 'critical'
                      : 'warn'
                }`}
              >
                {battle.gimmick.status}
              </span>
              <span className="num dim">
                {battle.gimmick.roundsLeft === null ? '제한 없음' : `${battle.gimmick.roundsLeft}R 남음`}
              </span>
              <NumberField
                label="진행"
                value={battle.gimmick.progress}
                onCommit={(value) => update(admin.setGimmickProgress(battle, value))}
              />
              <select
                className="ctl"
                value={battle.gimmick.status}
                onChange={(event) =>
                  update(admin.setGimmickStatus(battle, event.target.value as 'ACTIVE'))
                }
              >
                <option value="ACTIVE">진행 중</option>
                <option value="CLEARED">해제</option>
                <option value="FAILED">실패</option>
              </select>
            </div>
          )}

          {/* 무엇을 해야 풀리는 장치인지 — 판정을 인정할 때 기준이 된다 */}
          {battle.gimmick && (findGimmick(battle.gimmick.defId)?.approaches.length ?? 0) > 0 && (
            <Collapsible label="인정되는 접근 (판정 기준)">
              <table className="preview-table">
                <thead>
                  <tr>
                    <th>단계</th>
                    <th>접근</th>
                    <th>보정</th>
                    <th>인정 낱말</th>
                  </tr>
                </thead>
                <tbody>
                  {(findGimmick(battle.gimmick.defId)?.approaches ?? []).map((row) => (
                    <tr key={row.id}>
                      <td>
                        <span className={`tag ${row.stage === 'INSIGHT' ? 'blue' : 'gold'}`}>
                          {row.stage === 'INSIGHT' ? '파악' : '해결'}
                        </span>
                      </td>
                      <td>
                        {row.label}
                        <small className="dim">{row.detail}</small>
                      </td>
                      <td className="num">+{row.bonus}</td>
                      <td className="dim small-text">{row.keywords.join(' · ')}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={3} className="dim small-text">
                      어느 접근에도 걸리지 않은 선언
                    </td>
                    <td className="num warn-text">{GIMMICK_CHECK.offApproachPenalty}</td>
                  </tr>
                </tbody>
              </table>
            </Collapsible>
          )}
        </section>

        {/* 페어 모니터 */}
        <section className="panel">
          <div className="process-head">
            <h2 className="panel-title">PAIR MONITOR</h2>
            <div className="btn-row">
              {(
                [
                  ['ALL', '전체'],
                  ['GOVERNMENT', '정부'],
                  ['GUILD', '길드'],
                  ['INJURED', `부상 ${injured}`],
                  ['DOWN', `전투불능 ${down}`],
                  ['NOT_SUBMITTED', `미제출 ${waitingSides.length}`],
                ] as Array<[PairFilter, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`ctl small ${filter === value ? 'on' : ''}`}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                className={`ctl small ${monitorDense ? '' : 'on'}`}
                title="편집 도구까지 펼쳐 봅니다"
                onClick={() => setMonitorDense((current) => !current)}
              >
                {monitorDense ? '간략' : '상세'}
              </button>
            </div>
          </div>

          {/* 일괄 조작 — 페어를 하나씩 열어 같은 값을 넣는 일을 없앤다 */}
          <div className="bulk-bar">
            <button
              type="button"
              className="ctl small"
              onClick={() =>
                setBulkPairs((current) =>
                  current.length === filteredPairs.length
                    ? []
                    : filteredPairs.map((row) => row.id),
                )
              }
            >
              {bulkPairs.length === filteredPairs.length && filteredPairs.length > 0
                ? '선택 해제'
                : `보이는 ${filteredPairs.length}개 선택`}
            </button>
            <span className="field-label">선택 {bulkPairs.length}</span>
            <div className="btn-row">
              <button
                type="button"
                className="ctl small"
                disabled={bulkPairs.length === 0}
                onClick={() =>
                  runBulk('HP 완전 회복', (state, pairId) => {
                    const pair = state.pairs.find((row) => row.id === pairId);
                    return pair ? admin.setHunterHp(state, pairId, pair.hunter.maxHp) : state;
                  })
                }
              >
                HP 완전 회복
              </button>
              <button
                type="button"
                className="ctl small"
                disabled={bulkPairs.length === 0}
                onClick={() =>
                  runBulk('HP 절반 회복', (state, pairId) => {
                    const pair = state.pairs.find((row) => row.id === pairId);
                    if (!pair) return state;
                    const half = Math.ceil(pair.hunter.maxHp / 2);
                    return admin.setHunterHp(state, pairId, Math.max(pair.hunter.hp, half));
                  })
                }
              >
                HP 절반까지
              </button>
              <button
                type="button"
                className="ctl small"
                disabled={bulkPairs.length === 0}
                onClick={() =>
                  runBulk('행동력 충전', (state, pairId) => {
                    const pair = state.pairs.find((row) => row.id === pairId);
                    if (!pair) return state;
                    return admin.setActorAp(
                      admin.setActorAp(state, pairId, 'HUNTER', pair.hunter.maxAp),
                      pairId,
                      'CONSTELLATION',
                      pair.constellation.maxAp,
                    );
                  })
                }
              >
                AP 충전
              </button>
              <button
                type="button"
                className="ctl small"
                disabled={bulkPairs.length === 0}
                onClick={() => runBulk('상태이상 해제', clearStatuses)}
              >
                상태이상 해제
              </button>
              <button
                type="button"
                className="ctl small"
                disabled={bulkPairs.length === 0}
                onClick={() => runBulk('제출 초기화', admin.resetSubmission)}
              >
                제출 초기화
              </button>
              <select
                className="ctl small"
                value=""
                disabled={bulkPairs.length === 0}
                onChange={(event) => {
                  const reason = event.target.value;
                  if (!reason) return;
                  const rule = manualRewards().find((row) => row.reason === reason);
                  runBulk(`${rule?.labelKo ?? reason} 지급`, (state, pairId) =>
                    admin.grantPoints(
                      state,
                      pairId,
                      reason as Parameters<typeof admin.grantPoints>[2],
                    ),
                  );
                  event.target.value = '';
                }}
              >
                <option value="">포인트 일괄 지급…</option>
                {manualRewards().map((rule) => (
                  <option key={rule.reason} value={rule.reason}>
                    {rule.labelKo} · {rule.points}P
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="monitor-grid">
            {filteredPairs.map((pair) => {
              const injury = injuryOf(pair.hunter);
              const ready = pairReady(pair);

              return (
                <article
                  key={pair.id}
                  className={`monitor-card ${ready ? 'ready' : ''} ${
                    bulkPairs.includes(pair.id) ? 'picked' : ''
                  }`}
                >
                  <header className="monitor-head">
                    <div>
                      <input
                        type="checkbox"
                        className="bulk-check"
                        title="일괄 조작 대상"
                        checked={bulkPairs.includes(pair.id)}
                        onChange={() =>
                          setBulkPairs((current) =>
                            current.includes(pair.id)
                              ? current.filter((id) => id !== pair.id)
                              : [...current, pair.id],
                          )
                        }
                      />
                      <b>{pair.label}</b>
                      <span className={`tag ${pair.affiliation === 'GOVERNMENT' ? 'blue' : 'gold'}`}>
                        {pair.affiliation === 'GOVERNMENT' ? '정부' : '길드'}
                      </span>
                    </div>
                    <span
                      className={`tag ${
                        pair.hunter.hp <= 0 ? 'offline' : ready ? 'ok' : 'warn'
                      }`}
                    >
                      {pair.hunter.hp <= 0 ? '전투 불능' : ready ? '준비 완료' : '대기'}
                    </span>
                  </header>

                  {/* 쪽별 제출 상태 — 운영 판단의 핵심 */}
                  <div className="monitor-submission">
                    {(['HUNTER', 'CONSTELLATION'] as ActorSide[]).map((side) => {
                      const actor = side === 'HUNTER' ? pair.hunter : pair.constellation;
                      const submitted =
                        side === 'HUNTER'
                          ? pair.submission.hunterSubmitted
                          : pair.submission.constellationSubmitted;
                      const actionId =
                        side === 'HUNTER'
                          ? pair.submission.hunterActionId
                          : pair.submission.constellationActionId;

                      return (
                        <div className="submission-row" key={side}>
                          <span className={`tag ${side === 'HUNTER' ? 'blue' : 'gold'}`}>
                            {side === 'HUNTER' ? '헌터' : '성좌'}
                          </span>
                          <b>{actor.name}</b>
                          <span className="dim small-text">{actionId ?? '미선택'}</span>
                          <span className={`tag ${submitted ? 'ok' : 'warn'}`}>
                            {submitted ? '제출' : '대기'}
                          </span>
                          <button
                            type="button"
                            className={`ctl small ${actor.control === 'AUTO' ? 'on' : ''}`}
                            onClick={() =>
                              update(
                                admin.forceControl(
                                  battle,
                                  pair.id,
                                  side,
                                  actor.control === 'AUTO' ? 'ACTIVE' : 'AUTO',
                                ),
                              )
                            }
                          >
                            {actor.control === 'AUTO' ? 'AUTO 해제' : '강제 AUTO'}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <Bar value={pair.hunter.hp} max={pair.hunter.maxHp} tone={injury.tone} />
                  <div className="stat-strip">
                    <span>
                      <i>HP</i>
                      <b className="num">
                        {pair.hunter.hp}
                        <small>/{pair.hunter.maxHp}</small>
                      </b>
                    </span>
                    <span>
                      <i>헌터 AP</i>
                      <b className="num">
                        {pair.hunter.ap}
                        <small>/{pair.hunter.maxAp}</small>
                      </b>
                    </span>
                    <span>
                      <i>성좌 AP</i>
                      <b className="num">
                        {pair.constellation.ap}
                        <small>/{pair.constellation.maxAp}</small>
                      </b>
                    </span>
                    <span>
                      <i>권능</i>
                      <b className="num gold">×{pair.constellation.power}</b>
                    </span>
                    <span>
                      <i>헌터 P</i>
                      <b className="num gold">{pair.hunter.points ?? 0}</b>
                    </span>
                    <span>
                      <i>성좌 P</i>
                      <b className="num gold">{pair.constellation.points ?? 0}</b>
                    </span>
                  </div>

                  {monitorDense ? (
                    <div className="monitor-status">
                      <span className="field-label">상태</span>
                      {[
                        ...statusViews(pair.hunter.statuses),
                        ...statusViews(pair.constellation.statuses),
                      ].length === 0 ? (
                        <span className="dim small-text">없음</span>
                      ) : (
                        [
                          ...statusViews(pair.hunter.statuses),
                          ...statusViews(pair.constellation.statuses),
                        ].map((view, index) => (
                          <span key={`${view.label}-${index}`} className="tag">
                            {view.label}
                          </span>
                        ))
                      )}
                    </div>
                  ) : (
                  <div className="monitor-status">
                    <span className="field-label">헌터</span>
                    <StatusEditor
                      holder="HUNTER"
                      ownerId={pair.id}
                      statuses={pair.hunter.statuses}
                      onGrant={(h, o, d) => update(admin.grantStatus(battle, h, o, d))}
                      onRevoke={(h, o, d) => update(admin.revokeStatus(battle, h, o, d))}
                    />
                    <span className="field-label">성좌</span>
                    <StatusEditor
                      holder="CONSTELLATION"
                      ownerId={pair.id}
                      statuses={pair.constellation.statuses}
                      onGrant={(h, o, d) => update(admin.grantStatus(battle, h, o, d))}
                      onRevoke={(h, o, d) => update(admin.revokeStatus(battle, h, o, d))}
                    />
                  </div>
                  )}

                  {/* 참가자가 지금 무엇을 보고 있는지 — 안내를 하려면 같은 것을 봐야 한다 */}
                  <Collapsible label="참가자 시점">
                    <div className="viewer-peek">
                      <div>
                        <span className="field-label">장치</span>
                        {battle.gimmick ? (
                          <>
                            <span className={`tag ${battle.gimmick.identified ? 'ok' : 'warn'}`}>
                              {battle.gimmick.identified ? '파악 완료' : '미파악'}
                            </span>
                            {availableStage(battle.gimmick, pair) && (
                              <span className="tag blue">
                                다음 단계 ·{' '}
                                {availableStage(battle.gimmick, pair) === 'INSIGHT'
                                  ? '파악'
                                  : '해결'}
                              </span>
                            )}
                            <span className="dim small-text">
                              {gimmickBrief(battle.gimmick).text}
                            </span>
                          </>
                        ) : (
                          <span className="dim small-text">
                            이 층에는 장치가 없습니다 — 기믹 수행이 잠겨 있습니다.
                          </span>
                        )}
                      </div>
                      <div>
                        <span className="field-label">다음 패턴</span>
                        <span className={pair.patternRevealed ? 'gold' : 'dim'}>
                          {pair.patternRevealed
                            ? (peekTarget(pair)?.nextPattern ?? '없음')
                            : 'UNKNOWN (계시 없음)'}
                        </span>
                      </div>
                      {(['HUNTER', 'CONSTELLATION'] as ActorSide[]).map((side) => {
                        const blocked = actionsFor(pair, side)
                          .map((action) => ({
                            action,
                            availability: actionAvailability(
                              action,
                              pair,
                              Boolean(peekTarget(pair)),
                              battle.gimmick,
                            ),
                          }))
                          .filter((row) => !row.availability.usable);

                        return (
                          <div key={side}>
                            <span className="field-label">
                              {side === 'HUNTER' ? '헌터' : '성좌'} 잠긴 행동
                            </span>
                            {blocked.length === 0 ? (
                              <span className="dim small-text">없음 — 전부 고를 수 있습니다</span>
                            ) : (
                              blocked.map((row) => (
                                <span key={row.action.id} className="tag warn">
                                  {row.action.labelKo} · {row.availability.reason}
                                </span>
                              ))
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Collapsible>

                  {/* 판정 근거 — 스탯과 스킬을 모르면 기믹도 연출도 판정할 수 없다 */}
                  {!monitorDense && (
                  <Collapsible label="시트 · 스킬 (판정 참고)">
                    <div className="sheet-list">
                      <ActorSheet
                        side="HUNTER"
                        name={pair.hunter.name}
                        classId={pair.hunter.classId}
                        stats={pair.hunter.stats}
                        skills={pair.hunter.skills}
                        accountId={pair.hunterAccountId}
                        profile={sheetOf(pair.hunterAccountId)}
                        portrait={sheetOf(pair.hunterAccountId)?.portrait}
                      />
                      <ActorSheet
                        side="CONSTELLATION"
                        name={pair.constellation.name}
                        classId={pair.constellation.classId}
                        stats={pair.constellation.stats}
                        skills={pair.constellation.skills}
                        accountId={pair.constellationAccountId}
                        profile={sheetOf(pair.constellationAccountId)}
                        portrait={sheetOf(pair.constellationAccountId)?.portrait}
                      />
                    </div>
                  </Collapsible>
                  )}

                  {!monitorDense && (
                  <Collapsible label="수치 편집">
                    <div className="admin-grid">
                      <NumberField
                        label="HP"
                        value={pair.hunter.hp}
                        max={pair.hunter.maxHp}
                        onCommit={(value) => update(admin.setHunterHp(battle, pair.id, value))}
                      />
                      <NumberField
                        label="MAX HP"
                        value={pair.hunter.maxHp}
                        min={1}
                        onCommit={(value) => update(admin.setHunterMaxHp(battle, pair.id, value))}
                      />
                      <NumberField
                        label="헌터 AP"
                        value={pair.hunter.ap}
                        onCommit={(value) =>
                          update(admin.setActorAp(battle, pair.id, 'HUNTER', value))
                        }
                      />
                      <NumberField
                        label="성좌 AP"
                        value={pair.constellation.ap}
                        onCommit={(value) =>
                          update(admin.setActorAp(battle, pair.id, 'CONSTELLATION', value))
                        }
                      />
                      <NumberField
                        label="공격력"
                        value={pair.hunter.attack}
                        onCommit={(value) =>
                          update(admin.setHunterStats(battle, pair.id, { attack: value }))
                        }
                      />
                      <NumberField
                        label="방어력"
                        value={pair.hunter.defense}
                        onCommit={(value) =>
                          update(admin.setHunterStats(battle, pair.id, { defense: value }))
                        }
                      />
                      <NumberField
                        label="권능 배율"
                        value={pair.constellation.power}
                        step={0.01}
                        onCommit={(value) =>
                          update(admin.setConstellationPower(battle, pair.id, value))
                        }
                      />
                      <NumberField
                        label="헌터 소지금"
                        value={pair.hunter.points ?? 0}
                        step={10}
                        onCommit={(value) =>
                          update(admin.setActorPoints(battle, pair.id, 'HUNTER', value))
                        }
                      />
                      <NumberField
                        label="성좌 소지금"
                        value={pair.constellation.points ?? 0}
                        step={10}
                        onCommit={(value) =>
                          update(admin.setActorPoints(battle, pair.id, 'CONSTELLATION', value))
                        }
                      />
                      <label className="num-field">
                        <span className="field-label">성좌 상태</span>
                        <select
                          className="ctl input"
                          value={pair.constellation.stage}
                          onChange={(event) =>
                            update(
                              admin.setConstellationStage(
                                battle,
                                pair.id,
                                event.target.value as ConstellationStage,
                              ),
                            )
                          }
                        >
                          {Object.entries(CONSTELLATION_STAGES).map(([key, def]) => (
                            <option key={key} value={key}>
                              {def.labelKo}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="num-field">
                        <span className="field-label">계약 단계</span>
                        <select
                          className="ctl input"
                          value={pair.contract.stage}
                          onChange={(event) =>
                            update(
                              admin.setContract(battle, pair.id, {
                                stage: event.target.value as ContractStage,
                              }),
                            )
                          }
                        >
                          {Object.entries(CONTRACT_STAGES).map(([key, def]) => (
                            <option key={key} value={key}>
                              {def.labelKo}
                            </option>
                          ))}
                        </select>
                      </label>
                      <NumberField
                        label="부분 현신"
                        value={pair.constellation.manifestUses.partial ?? 0}
                        onCommit={(value) =>
                          update(admin.setManifestUses(battle, pair.id, { partial: value }))
                        }
                      />
                      <NumberField
                        label="완전 현신"
                        value={pair.constellation.manifestUses.full ?? 0}
                        onCommit={(value) =>
                          update(admin.setManifestUses(battle, pair.id, { full: value }))
                        }
                      />
                    </div>

                    {/* 가방은 사람마다 따로다 — 누구에게 주는지 골라서 지급한다 */}
                    {(['HUNTER', 'CONSTELLATION'] as ActorSide[]).map((side) => {
                      const bag = bagOf(pair, side);
                      const owner = side === 'HUNTER' ? pair.hunter.name : pair.constellation.name;
                      return (
                        <div key={`bag-${side}`}>
                          <h4 className="sub-title">
                            아이템 지급 · 회수 — {sideLabel(side)} {owner}
                          </h4>
                          <div className="item-admin">
                            {bag.length === 0 ? (
                              <p className="dim small-text">가방이 비어 있습니다.</p>
                            ) : (
                              <ul className="inventory-list">
                                {bag.map((stack) => {
                                  const item = findItem(stack.itemId);
                                  if (!item) return null;
                                  return (
                                    <li key={stack.itemId}>
                                      <span>{item.nameKo}</span>
                                      <b className="num gold">{stack.quantity}</b>
                                      <button
                                        type="button"
                                        className="ctl small"
                                        onClick={() =>
                                          update(
                                            admin.grantItem(
                                              battle,
                                              pair.id,
                                              side,
                                              stack.itemId,
                                              1,
                                            ),
                                          )
                                        }
                                      >
                                        +1
                                      </button>
                                      <button
                                        type="button"
                                        className="ctl small"
                                        onClick={() =>
                                          update(
                                            admin.revokeItem(
                                              battle,
                                              pair.id,
                                              side,
                                              stack.itemId,
                                              1,
                                            ),
                                          )
                                        }
                                      >
                                        −1
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                            <select
                              className="ctl input"
                              value=""
                              onChange={(event) => {
                                if (!event.target.value) return;
                                update(
                                  admin.grantItem(battle, pair.id, side, event.target.value, 1),
                                );
                              }}
                            >
                              <option value="">아이템 지급…</option>
                              {ITEM_DEFINITIONS.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.nameKo} ·{' '}
                                  {describeItem(item).join(' / ') || '효과 없음'}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })}

                    <h4 className="sub-title">소지금 지급</h4>
                    <div className="item-admin">
                      {/* 소지금은 개인 소유다 — 누구에게 줄지 먼저 고른다 */}
                      <label className="num-field">
                        <span className="field-label">받는 사람</span>
                        <select
                          className="ctl input"
                          value={rewardSide[pair.id] ?? 'BOTH'}
                          onChange={(event) =>
                            setRewardSide((current) => ({
                              ...current,
                              [pair.id]: event.target.value as 'BOTH' | ActorSide,
                            }))
                          }
                        >
                          <option value="BOTH">두 사람 — 각자 같은 금액을 받습니다</option>
                          <option value="HUNTER">헌터 {pair.hunter.name}</option>
                          <option value="CONSTELLATION">성좌 {pair.constellation.name}</option>
                        </select>
                      </label>
                      <select
                        className="ctl input"
                        value=""
                        onChange={(event) => {
                          const reason = event.target.value;
                          if (!reason) return;
                          const target = rewardSide[pair.id] ?? 'BOTH';
                          update(
                            admin.grantPoints(
                              battle,
                              pair.id,
                              reason as Parameters<typeof admin.grantPoints>[2],
                              undefined,
                              target === 'BOTH' ? null : target,
                            ),
                          );
                        }}
                      >
                        <option value="">수동 지급 사유…</option>
                        {manualRewards().map((rule) => (
                          <option key={rule.reason} value={rule.reason}>
                            {rule.labelKo} · {rule.points}P
                            {rule.range ? ` (${rule.range.min}~${rule.range.max})` : ''}
                          </option>
                        ))}
                      </select>
                      {battle.rewards.filter((row) => row.pairId === pair.id).length > 0 && (
                        <ul className="inventory-list">
                          {battle.rewards
                            .filter((row) => row.pairId === pair.id)
                            .map((row) => (
                              <li key={row.id}>
                                <span>R{row.round}</span>
                                <span>{row.label}</span>
                                <span className="tag">{rewardSideLabel(row.side)}</span>
                                <b className="num gold">+{row.points}</b>
                                <button
                                  type="button"
                                  className="ctl small"
                                  title="지급을 취소하고 소지금을 되돌립니다"
                                  onClick={() => update(admin.revokeReward(battle, row.id))}
                                >
                                  ✕
                                </button>
                              </li>
                            ))}
                        </ul>
                      )}
                    </div>
                  </Collapsible>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        {/* 라운드 처리 */}
        <section className="panel process" ref={processRef}>
          <div className="process-head">
            <h2 className="panel-title">ROUND {String(battle.round).padStart(2, '0')} 처리</h2>
            <div className="btn-row">
              {undoBattle && (
                <button
                  type="button"
                  className="ctl small"
                  title={`ROUND ${undoBattle.round} 확정 직전으로 되돌립니다`}
                  onClick={undoApply}
                >
                  ↩ ROUND {undoBattle.round} 되돌리기
                </button>
              )}
            </div>
          </div>
          <p className="hint">
            APPLY 전에 피해량과 연계를 직접 수정할 수 있습니다. 자동 계산은 제안일 뿐입니다.
          </p>

          {!preview ? (
            <button
              type="button"
              className="ctl wide"
              disabled={battle.status !== 'ENGAGED'}
              onClick={computeRound}
            >
              라운드 계산
              {waitingSides.length > 0 && (
                <small>미제출 {waitingSides.length}건은 자동 행동으로 채워집니다</small>
              )}
            </button>
          ) : (
            <div className="preview">
              <table className="preview-table editable">
                <thead>
                  <tr>
                    <th>페어</th>
                    <th>헌터</th>
                    <th>성좌</th>
                    <th>연계</th>
                    <th>피해</th>
                    <th>비고</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.pairs.map((row) => (
                    <tr key={row.pairId}>
                      <td>{row.pairLabel}</td>
                      <td>
                        {row.hunterActionLabel}
                        {row.autoFilled.includes('HUNTER') && (
                          <span className="tag auto">AUTO</span>
                        )}
                      </td>
                      <td>
                        {row.constellationActionLabel}
                        {row.autoFilled.includes('CONSTELLATION') && (
                          <span className="tag auto">AUTO</span>
                        )}
                      </td>
                      <td>
                        {row.combo ? (
                          <button
                            type="button"
                            className="tag ok removable"
                            title="클릭하면 연계 취소"
                            onClick={() => patchPreviewPair(row.pairId, { combo: null })}
                          >
                            {row.combo.label} ✕
                          </button>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                      <td>
                        <input
                          className="ctl input tiny"
                          type="number"
                          value={row.damageToEnemy}
                          onChange={(event) =>
                            patchPreviewPair(row.pairId, {
                              damageToEnemy: Math.max(0, Number(event.target.value) || 0),
                            })
                          }
                        />
                      </td>
                      <td className="dim small-text">
                        {row.gimmickNote && (
                          <div className="judge-box">
                            <span className={`tag ${row.gimmickCheck?.stage === 'INSIGHT' ? 'blue' : 'gold'}`}>
                              {row.gimmickCheck?.stage === 'INSIGHT' ? '파악' : '해결'}
                            </span>
                            <span className="judge-note">{row.gimmickNote}</span>
                            {row.gimmickCheck && (
                              <span
                                className={`tag ${row.gimmickCheck.approachLabel ? 'ok' : 'warn'}`}
                                title="선언이 인정되는 접근에 걸렸는지"
                              >
                                {row.gimmickCheck.approachLabel ?? '접근 불인정'}
                              </span>
                            )}
                            {row.gimmickCheck && (
                              <span
                                className={`tag ${row.gimmickCheck.success ? 'ok' : 'critical'}`}
                                title={row.gimmickCheck.breakdown.join(' / ')}
                              >
                                {row.gimmickCheck.rolls.join('+')}+{row.gimmickCheck.bonus}={' '}
                                {row.gimmickCheck.total} vs {row.gimmickCheck.dc}
                              </span>
                            )}
                            {row.gimmickCheck?.stage === 'RESOLVE' && (
                              <label className="judge-progress">
                                <span className="field-label">진행</span>
                                <input
                                  className="ctl input tiny"
                                  type="number"
                                  value={row.gimmickProgress}
                                  onChange={(event) =>
                                    patchPreviewPair(row.pairId, {
                                      gimmickProgress: Math.max(
                                        0,
                                        Number(event.target.value) || 0,
                                      ),
                                    })
                                  }
                                />
                              </label>
                            )}
                            {row.gimmickCheck?.stage === 'INSIGHT' && (
                              <button
                                type="button"
                                className={`ctl small ${row.gimmickIdentified ? 'on' : ''}`}
                                onClick={() =>
                                  patchPreviewPair(row.pairId, {
                                    gimmickIdentified: !row.gimmickIdentified,
                                  })
                                }
                              >
                                {row.gimmickIdentified ? '파악 인정' : '파악 불인정'}
                              </button>
                            )}
                          </div>
                        )}
                        {[
                          row.skipped ? row.skipReason : null,
                          row.rescue
                            ? `구조 ${row.rescue.targetLabel} +${row.rescue.restoredHp}`
                            : null,
                          !row.gimmickNote && row.gimmickProgress > 0
                            ? `기믹 +${row.gimmickProgress}`
                            : null,
                          row.itemUses
                            .map((use) => `${use.itemName} (AP ${use.apCost})`)
                            .join(' · ') || null,
                          row.itemDamageToEnemy > 0 ? `아이템 피해 ${row.itemDamageToEnemy}` : null,
                          row.heals.map((heal) => `${heal.targetLabel} 회복 +${heal.amount}`).join(' · ') ||
                            null,
                          row.contractDelta !== 0
                            ? `계약 ${row.contractDelta > 0 ? '+' : ''}${row.contractDelta}`
                            : null,
                          row.stageDrop > 0
                            ? '성좌 상태 하락'
                            : row.stageDrop < 0
                              ? '성좌 상태 회복'
                              : null,
                          row.rewards.map((reward) => `${reward.label} +${reward.points}P`).join(' · ') ||
                            null,
                          row.appliedStatuses.map((s) => s.label).join(' · ') || null,
                        ]
                          .filter(Boolean)
                          .join(' / ')}
                      </td>
                    </tr>
                  ))}

                  {preview.enemies.map((row) => (
                    <tr key={row.enemyId} className="enemy-row">
                      <td>{row.enemyName}</td>
                      <td colSpan={3}>
                        {row.pattern}
                        {row.aoe && <span className="tag critical">광역</span>}
                        {row.blocked && <span className="tag ok">봉인</span>}
                        {row.telegraph && <span className="tag warn">예고</span>}
                      </td>
                      <td>
                        <input
                          className="ctl input tiny"
                          type="number"
                          value={row.damageToHunter}
                          onChange={(event) =>
                            patchPreviewEnemy(
                              row.enemyId,
                              Math.max(0, Number(event.target.value) || 0),
                            )
                          }
                        />
                      </td>
                      <td className="dim small-text">{row.notes[0]}</td>
                    </tr>
                  ))}

                  {preview.statusTicks.map((tick) => (
                    <tr key={`${tick.ownerId}-${tick.defId}`} className="tick-row">
                      <td>{tick.ownerLabel}</td>
                      <td colSpan={3}>{tick.label} 지속 피해</td>
                      <td className="num">{tick.amount}</td>
                      <td className="dim small-text">라운드 종료</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {preview.alerts.length > 0 && (
                <ul className="preview-alerts">
                  {preview.alerts.map((item) => (
                    <li key={`${item.title}-${item.message}`}>
                      <span className="tag critical">{item.level}</span> {item.title} —{' '}
                      {item.message}
                    </li>
                  ))}
                </ul>
              )}

              <div className="btn-row">
                <button
                  type="button"
                  className="ctl primary"
                  onClick={applyPreview}
                >
                  결과 확정 · APPLY
                </button>
                <button type="button" className="ctl" onClick={computeRound}>
                  재계산
                </button>
                <button type="button" className="ctl" onClick={() => setPreview(null)}>
                  취소
                </button>
              </div>
            </div>
          )}
        </section>

        {/*
           운영 도크.
           페어 모니터가 길어지면 상태 확인과 라운드 처리가 화면 양 끝으로 멀어진다.
           지금 필요한 숫자와 다음 한 수를 화면 아래에 붙여 둔다.
        */}
        <section className="panel ops-dock">
          <div className="ops-dock-status">
            <span>
              <i>준비</i>
              <b className={`num ${readyCount === battle.pairs.length ? 'ok-text' : ''}`}>
                {readyCount}/{battle.pairs.length}
              </b>
            </span>
            <span>
              <i>미제출</i>
              <b className={`num ${waitingSides.length > 0 ? 'warn-text' : ''}`}>
                {waitingSides.length}
              </b>
            </span>
            <span>
              <i>전투불능</i>
              <b className={`num ${down > 0 ? 'danger-text' : ''}`}>{down}</b>
            </span>
            {battle.gimmick && (
              <span>
                <i>기믹</i>
                <b className="num">
                  {battle.gimmick.progress}/{battle.gimmick.required}
                </b>
              </span>
            )}
          </div>
          <div className="btn-row">
            <button type="button" className="ctl small" onClick={() => jumpTo(chatRef)}>
              채널 ↓
            </button>
            {undoBattle && (
              <button type="button" className="ctl small" onClick={undoApply}>
                ↩ R{undoBattle.round}
              </button>
            )}
            {waitingSides.length > 0 && (
              <button type="button" className="ctl small" onClick={callWaiting}>
                호출
              </button>
            )}
            {preview ? (
              <>
                <button type="button" className="ctl small" onClick={() => jumpTo(processRef)}>
                  결과표
                </button>
                <button type="button" className="ctl primary" onClick={applyPreview}>
                  결과 확정 · APPLY
                </button>
              </>
            ) : (
              <button
                type="button"
                className="ctl primary"
                disabled={battle.status !== 'ENGAGED'}
                onClick={computeRound}
              >
                ROUND {String(battle.round).padStart(2, '0')} 계산
              </button>
            )}
          </div>
        </section>
      </>
  );
}
