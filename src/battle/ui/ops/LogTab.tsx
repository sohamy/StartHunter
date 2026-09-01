/**
 * 전투 로그 탭.
 *
 * 시스템 로그는 엔진이 적은 판정 기록이고, 연출 로그는 사람이 적은 글이다.
 * 둘을 한 목록에 섞으면 어느 쪽도 읽히지 않아 탭으로 가른다.
 *
 * 연출 로그는 운영진이 그 자리에서 고칠 수 있다 — 자동 판정보다 사람이 위다.
 */

import { useState } from 'react';

import * as admin from '../../engine/admin';
import { useOps } from './OpsContext';
import { confirmed, type LogTab as LogChannel } from './shared';
import type { BattleState } from '../../types';

export default function LogTab({
  battle,
  update,
}: {
  battle: BattleState | null;
  update: (next: BattleState) => void;
}) {
  const { copyText } = useOps();
  const [logTab, setLogTab] = useState<LogChannel>('SYSTEM');
  /** 지금 고치고 있는 연출 로그 — 한 번에 하나만 연다 */
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [logDraft, setLogDraft] = useState('');

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

      {!battle ? (
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
