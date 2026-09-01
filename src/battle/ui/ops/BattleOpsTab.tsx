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

import * as admin from '../../engine/admin';
import { newUuid } from '../../engine/id';
import { applyRound, previewRound } from '../../engine/round';
import { useOps } from './OpsContext';
import PairMonitor, { type PairFilter } from './battle/PairMonitor';
import RoundProcess from './battle/RoundProcess';
import TargetPanel from './battle/TargetPanel';
import { NumberField, battleTally, confirmed } from './shared';
import type {
  ActorSide,
  BattleState,
  CharacterSheet,
  EnemyState,
  PairBond,
  RoundPreview,
} from '../../types';


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
        <TargetPanel battle={battle} preview={preview} update={update} />

        {/* 페어 모니터 */}
        <PairMonitor
          battle={battle}
          update={update}
          sheetOf={sheetOf}
          filteredPairs={filteredPairs}
          filter={filter}
          setFilter={setFilter}
          monitorDense={monitorDense}
          setMonitorDense={setMonitorDense}
          bulkPairs={bulkPairs}
          setBulkPairs={setBulkPairs}
          rewardSide={rewardSide}
          setRewardSide={setRewardSide}
          runBulk={runBulk}
          clearStatuses={clearStatuses}
          peekTarget={peekTarget}
          injured={injured}
          down={down}
          waitingSides={waitingSides}
        />

        {/* 라운드 처리 */}
        <RoundProcess
          battle={battle}
          preview={preview}
          setPreview={setPreview}
          patchPreviewPair={patchPreviewPair}
          patchPreviewEnemy={patchPreviewEnemy}
          computeRound={computeRound}
          applyPreview={applyPreview}
          undoApply={undoApply}
          undoBattle={undoBattle}
          filter={filter}
          waitingSides={waitingSides}
          processRef={processRef}
        />

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
