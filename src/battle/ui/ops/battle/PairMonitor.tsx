/**
 * 페어 모니터 — 한 쌍씩 들여다보고 손으로 고치는 곳.
 *
 * 이 화면이 작전실에서 가장 크다. 페어마다 HP · 행동력 · 계약 · 상태이상 · 제출 ·
 * 소지금 · 가방 · 기믹 판정이 모두 붙어 있고, 그 전부를 운영진이 덮어쓸 수 있다.
 *
 * 페어가 늘면 카드 하나가 화면 한 장을 먹으므로 기본은 접어 둔다(monitorDense).
 * 같은 조작을 여러 페어에 반복하는 일이 잦아 일괄 처리(bulkPairs)를 함께 둔다.
 */

import type { Dispatch, SetStateAction } from 'react';

import { ITEM_DEFINITIONS, describeItem, findItem } from '../../../config/items';
import { CONSTELLATION_STAGES, CONTRACT_STAGES } from '../../../config/rules';
import { manualRewards } from '../../../config/rewards';
import * as admin from '../../../engine/admin';
import { pairReady } from '../../../engine/battle';
import { availableStage, gimmickBrief } from '../../../engine/gimmick';
import { bagOf } from '../../../engine/items';
import { rewardSideLabel } from '../../../engine/rewards';
import { actionAvailability } from '../../../engine/round';
import { actionsFor } from '../../../engine/skills';
import { injuryOf, statusViews } from '../../../engine/status';
import Collapsible from '../../Collapsible';
import { ActorSheet, sideLabel } from '../../SheetView';
import { Bar, NumberField, StatusEditor } from '../shared';
import type {
  ActorSide,
  BattleState,
  CharacterSheet,
  ConstellationStage,
  ContractStage,
  EnemyState,
  PairState,
} from '../../../types';

/** 페어를 걸러 보는 잣대 — 라운드 처리 표도 같은 것을 쓴다 */
export type PairFilter = 'ALL' | 'GOVERNMENT' | 'GUILD' | 'INJURED' | 'DOWN' | 'NOT_SUBMITTED';

export default function PairMonitor({
  battle,
  update,
  sheetOf,
  filteredPairs,
  filter,
  setFilter,
  monitorDense,
  setMonitorDense,
  bulkPairs,
  setBulkPairs,
  rewardSide,
  setRewardSide,
  runBulk,
  clearStatuses,
  peekTarget,
  injured,
  down,
  waitingSides,
}: {
  battle: BattleState;
  update: (next: BattleState) => void;
  sheetOf: (accountId: string | null) => CharacterSheet | null;
  filteredPairs: PairState[];
  filter: PairFilter;
  setFilter: Dispatch<SetStateAction<PairFilter>>;
  monitorDense: boolean;
  setMonitorDense: Dispatch<SetStateAction<boolean>>;
  bulkPairs: string[];
  setBulkPairs: Dispatch<SetStateAction<string[]>>;
  /** 소지금 지급 대상 — 페어 id 마다 기억한다. BOTH 는 두 사람이 각자 받는다 */
  rewardSide: Record<string, 'BOTH' | ActorSide>;
  setRewardSide: Dispatch<SetStateAction<Record<string, 'BOTH' | ActorSide>>>;
  runBulk: (label: string, step: (state: BattleState, pairId: string) => BattleState) => void;
  clearStatuses: (state: BattleState, pairId: string) => BattleState;
  peekTarget: (pair: PairState) => EnemyState | null;
  injured: number;
  down: number;
  waitingSides: Array<{ pairId: string; label: string; side: ActorSide }>;
}) {
  return (
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
  );
}
