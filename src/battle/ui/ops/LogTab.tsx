/**
 * 전투 로그 탭.
 *
 * 시스템 로그는 엔진이 적은 판정 기록이고, 연출 로그는 사람이 적은 글이다.
 * 둘을 한 목록에 섞으면 어느 쪽도 읽히지 않아 탭으로 가른다.
 *
 * 연출 로그는 운영진이 그 자리에서 고칠 수 있다 — 자동 판정보다 사람이 위다.
 *
 * 세 번째 칸은 **운영 기록**이다. 앞의 둘이 전투 안에서 벌어진 일이라면 이쪽은
 * 전투 밖에서 운영진이 사람의 값을 고친 일 — 소지금 · 보급품 · 시트 · 정산이다.
 * 전투와 함께 사라지지 않고 계정에 영구히 남는 값이라 따로 남긴다.
 */

import { useEffect, useState } from 'react';

import * as admin from '../../engine/admin';
import { useOps } from './OpsContext';
import { confirmed, shortTime, type LogTab as BattleChannel } from './shared';
import type { AuditEntry } from '../../store';
import type { BattleState } from '../../types';

type Channel = BattleChannel | 'AUDIT';

/** 무엇을 한 일인지 한 낱말로 */
const ACTION_LABEL: Record<AuditEntry['action'], string> = {
  POINTS: '소지금',
  ITEM: '보급품',
  TRADE: '대리 매매',
  SHEET: '시트 저장',
  SHEET_DELETE: '시트 삭제',
  SETTLE: '정산',
};

export default function LogTab({
  battle,
  update,
}: {
  battle: BattleState | null;
  update: (next: BattleState) => void;
}) {
  const { audit, copyText } = useOps();
  const [logTab, setLogTab] = useState<Channel>('SYSTEM');
  const [trail, setTrail] = useState<AuditEntry[] | null>(null);
  const [trailError, setTrailError] = useState<string | null>(null);
  /** 지금 고치고 있는 연출 로그 — 한 번에 하나만 연다 */
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [logDraft, setLogDraft] = useState('');

  /* 운영 기록은 이 칸을 열 때 읽는다 — 전투 로그와 달리 서버에 따로 있다 */
  useEffect(() => {
    if (logTab !== 'AUDIT') return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await audit.listAudit(200);
        if (!cancelled) {
          setTrail(rows);
          setTrailError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setTrail([]);
          setTrailError(
            caught instanceof Error ? caught.message : '운영 기록을 불러오지 못했습니다.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [audit, logTab]);

  return (
    <section className="panel log">
      <div className="process-head">
        <div className="btn-row">
          <button
            type="button"
            className={`ctl small ${logTab === 'SYSTEM' ? 'on' : ''}`}
            onClick={() => setLogTab('SYSTEM')}
          >
            시스템 로그
          </button>
          <button
            type="button"
            className={`ctl small ${logTab === 'ROLEPLAY' ? 'on' : ''}`}
            onClick={() => setLogTab('ROLEPLAY')}
          >
            연출 로그
          </button>
          <button
            type="button"
            className={`ctl small ${logTab === 'AUDIT' ? 'on' : ''}`}
            onClick={() => setLogTab('AUDIT')}
          >
            운영 기록
          </button>
        </div>
        {battle && battle.alerts.length > 0 && (
          <button
            type="button"
            className="ctl small"
            onClick={() => update(admin.clearAlerts(battle))}
          >
            경보 지우기
          </button>
        )}
      </div>

      {logTab === 'AUDIT' ? (
        <>
          <p className="hint" style={{ marginBottom: 10 }}>
            운영진이 참가자의 <b>소지금 · 보급품 · 시트</b>를 고친 기록입니다. 덧붙이기만 하며
            지울 수 없습니다 — 지울 수 있는 기록은 근거가 되지 못합니다. 전투 중 HP · 행동력
            수정은 여기 담기지 않습니다.
          </p>
          {trailError && <p className="notice warn">{trailError}</p>}
          {trail === null ? (
            <p className="dim">불러오는 중…</p>
          ) : trail.length === 0 ? (
            <p className="dim">남은 기록이 없습니다.</p>
          ) : (
            <div className="preview">
              <table className="preview-table">
                <thead>
                  <tr>
                    <th>시각</th>
                    <th>한 사람</th>
                    <th>대상</th>
                    <th>무엇을</th>
                    <th>내용</th>
                    <th>값</th>
                    <th>사유</th>
                  </tr>
                </thead>
                <tbody>
                  {trail.map((entry) => (
                    <tr key={entry.id}>
                      <td className="dim num">{shortTime(entry.at)}</td>
                      <td>{entry.byHandle}</td>
                      <td>{entry.targetName || <span className="dim">—</span>}</td>
                      <td>
                        <span className="tag">{ACTION_LABEL[entry.action] ?? entry.action}</span>
                      </td>
                      <td>{entry.summary}</td>
                      <td className="num">
                        {entry.before === null && entry.after === null ? (
                          <span className="dim">—</span>
                        ) : (
                          `${entry.before ?? '—'} → ${entry.after ?? '—'}`
                        )}
                      </td>
                      <td className={entry.reason ? '' : 'dim'}>{entry.reason ?? '적지 않음'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : !battle ? (
        <p className="dim">전투를 열면 로그가 표시됩니다.</p>
      ) : logTab === 'SYSTEM' ? (
        <ol className="log-list">
          {[...battle.log.filter((entry) => entry.channel === 'SYSTEM')]
            .reverse()
            .slice(0, 150)
            .map((entry) => (
              <li key={entry.id}>
                <span className="log-time num">[{entry.at}]</span>
                <span className="log-text">
                  {entry.text}
                  {entry.detail && <small className="dim">{entry.detail}</small>}
                </span>
              </li>
            ))}
        </ol>
      ) : (
        <div className="roleplay-list">
          {battle.log.filter((entry) => entry.channel === 'ROLEPLAY').length === 0 && (
            <p className="dim">라운드를 처리하면 연출 로그가 생성됩니다.</p>
          )}
          {[...battle.log.filter((entry) => entry.channel === 'ROLEPLAY')]
            .reverse()
            .map((entry) => (
              <article className="roleplay-block" key={entry.id}>
                <header className="roleplay-head">
                  <span className="field-label">
                    ROUND {String(entry.round).padStart(2, '0')} · {entry.at}
                    {entry.edited && <span className="tag warn"> 수정됨</span>}
                  </span>
                  <div className="btn-row">
                    <button
                      type="button"
                      className="ctl small"
                      onClick={() => void copyText(entry.text)}
                    >
                      복사
                    </button>
                    {editingLogId === entry.id ? (
                      <>
                        <button
                          type="button"
                          className="ctl small on"
                          onClick={() => {
                            update(admin.editLogEntry(battle, entry.id, logDraft));
                            setEditingLogId(null);
                          }}
                        >
                          저장
                        </button>
                        <button
                          type="button"
                          className="ctl small"
                          onClick={() => setEditingLogId(null)}
                        >
                          취소
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="ctl small"
                        onClick={() => {
                          setEditingLogId(entry.id);
                          setLogDraft(entry.text);
                        }}
                      >
                        수정
                      </button>
                    )}
                    <button
                      type="button"
                      className="ctl small"
                      title="이 기록을 지웁니다"
                      onClick={() => {
                        if (confirmed('이 연출 기록을 지웁니다. 되돌릴 수 없습니다.')) {
                          update(admin.removeLogEntry(battle, entry.id));
                        }
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </header>
                {editingLogId === entry.id ? (
                  <textarea
                    className="ctl input textarea roleplay-edit"
                    rows={Math.min(24, logDraft.split('\n').length + 2)}
                    value={logDraft}
                    onChange={(event) => setLogDraft(event.target.value)}
                  />
                ) : (
                  <pre className="roleplay-text">{entry.text}</pre>
                )}
              </article>
            ))}
        </div>
      )}
    </section>
  );
}
