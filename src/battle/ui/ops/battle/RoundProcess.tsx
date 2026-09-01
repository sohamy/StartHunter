/**
 * 라운드 처리 — 계산하고, 고치고, 확정한다.
 *
 * 표에 뜬 값은 전부 손으로 덮어쓸 수 있다. **자동 판정이 운영진보다 위가 아니다.**
 * 확정한 뒤에도 한 번은 되돌릴 수 있다 — 수치를 손으로 복원하는 일을 없애기 위한 것이다.
 */

import type { RefObject } from 'react';

import type { ActorSide, BattleState, RoundPreview } from '../../../types';
import type { PairFilter } from './PairMonitor';

export default function RoundProcess({
  battle,
  preview,
  setPreview,
  patchPreviewPair,
  patchPreviewEnemy,
  computeRound,
  applyPreview,
  undoApply,
  undoBattle,
  filter,
  waitingSides,
  processRef,
}: {
  battle: BattleState;
  preview: RoundPreview | null;
  setPreview: (next: RoundPreview | null) => void;
  patchPreviewPair: (pairId: string, patch: Partial<RoundPreview['pairs'][number]>) => void;
  patchPreviewEnemy: (enemyId: string, damage: number) => void;
  computeRound: () => void;
  applyPreview: () => void;
  undoApply: () => void;
  /** 되돌릴 수 있는 직전 상태. 없으면 되돌리기 버튼을 잠근다 */
  undoBattle: BattleState | null;
  /** 페어 걸러 보기 — 표에도 같은 잣대를 쓴다 */
  filter: PairFilter;
  waitingSides: Array<{ pairId: string; label: string; side: ActorSide }>;
  /** 어디서 계산을 눌러도 결과표 앞으로 데려간다 */
  processRef: RefObject<HTMLElement | null>;
}) {
  return (
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
  );
}
