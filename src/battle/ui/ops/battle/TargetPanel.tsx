/**
 * 적 상황판 — 운영진이 보고 곧바로 고치는 칸.
 *
 * 자동 판정이 매긴 HP · 페이즈 · 상태이상을 여기서 손으로 덮어쓸 수 있다.
 * 다음 패턴이 무엇인지도 함께 띄운다 — 예고 없이 큰 것이 날아오면 운영이 안 된다.
 */

import { GIMMICK_CHECK, findGimmick } from '../../../config/gimmicks';
import * as admin from '../../../engine/admin';
import { describePhaseBands, nextPatternAdmin } from '../../../engine/enemy';
import AttackEditor from '../../AttackEditor';
import Collapsible from '../../Collapsible';
import { Bar, NumberField, StatusEditor } from '../shared';
import type { BattleState, RoundPreview } from '../../../types';

export default function TargetPanel({
  battle,
  preview,
  update,
}: {
  battle: BattleState;
  preview: RoundPreview | null;
  update: (next: BattleState) => void;
}) {
  return (
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
  );
}
