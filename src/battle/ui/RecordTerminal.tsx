/**
 * 공개 전투 기록 단말 — 주소 하나로 한 판을 보여준다.
 *
 * `/battle/record/?id=기록id` 으로 연다. **로그인하지 않아도** 누구나 읽는다 —
 * 「우리 3층 클리어」를 커뮤니티에 붙이는 것이 목적이다.
 *
 * 담기는 것: 작전 · 층 · 결과 · 라운드 수 · 보스 · 기믹 · 페어별 성적 · 연출 로그.
 * 담기지 않는 것: 소지금 잔액 · 가방 · 운영진 메모 · 시스템 로그.
 * 「얻은 포인트」는 그 판의 성적이라 싣고, 「가진 포인트」는 지갑이라 감춘다.
 * 무엇을 감추는지는 서버 뷰(0023 · public_records)가 정한다 — 화면이 고르는 것이 아니다.
 */

import { useEffect, useState } from 'react';

import { getStorage, type PublicRecord } from '../store';
import TerminalNav from './TerminalNav';

type Phase = 'LOADING' | 'READY' | 'NO_ID' | 'NOT_FOUND';

function base(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, '');
}

/** 주소에서 기록 id 를 꺼낸다 */
function readId(): string {
  if (typeof window === 'undefined') return '';
  return (new URLSearchParams(window.location.search).get('id') ?? '').trim();
}

/** 「2026-09-02 21:05」 */
function fullTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export default function RecordTerminal() {
  const [phase, setPhase] = useState<Phase>('LOADING');
  const [record, setRecord] = useState<PublicRecord | null>(null);

  useEffect(() => {
    const id = readId();
    if (!id) {
      setPhase('NO_ID');
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const found = await getStorage().getPublicRecord(id);
        if (cancelled) return;
        setRecord(found);
        setPhase(found ? 'READY' : 'NOT_FOUND');
      } catch {
        if (!cancelled) setPhase('NOT_FOUND');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (phase === 'LOADING') {
    return (
      <div className="console">
        <TerminalNav current="record" />
        <p className="console-loading">LOADING…</p>
      </div>
    );
  }

  if (phase !== 'READY' || !record) {
    return (
      <div className="console">
        <TerminalNav current="record" />
        <section className="panel">
          <h2 className="panel-title">공략 기록</h2>
          <p className="notice warn">
            {phase === 'NO_ID'
              ? '주소에 기록 번호가 없습니다. 관리국이 남긴 주소를 그대로 열어 주세요.'
              : '기록을 찾을 수 없습니다. 아직 보관되지 않았거나 지워진 기록입니다.'}
          </p>
          <a className="ctl" href={`${base()}/battle/board/`}>
            명부 게시판으로
          </a>
        </section>
      </div>
    );
  }

  const cleared = record.status === 'CLEARED';
  const earned = record.pairs.reduce((sum, pair) => sum + pair.pointsEarned, 0);

  return (
    <div className="console">
      <TerminalNav current="record" />

      <header className="console-head">
        <div className="agency">
          <b>HUNTER MANAGEMENT AGENCY</b>
          <span>RAID RECORD</span>
        </div>
        <dl className="ops">
          <div className="field">
            <span className="field-label">층</span>
            <span className="field-value num">
              {String(record.operation.floor).padStart(2, '0')}
            </span>
          </div>
          <div className="field">
            <span className="field-label">라운드</span>
            <span className="field-value num">{record.rounds}</span>
          </div>
          <div className="field">
            <span className="field-label">결과</span>
            <span className={`tag ${cleared ? 'ok' : 'critical'}`}>
              {cleared ? '클리어' : '실패'}
            </span>
          </div>
        </dl>
      </header>

      <section className="panel record">
        <div className="process-head">
          <h2 className="panel-title">{record.operation.name}</h2>
          <span className="hint">
            {fullTime(record.finishedAt)} · 위협도 {record.operation.threatLevel} · {record.mode}
          </span>
        </div>

        <div className="btn-row">
          {record.bossName && <span className="tag gold">{record.bossName}</span>}
          {record.gimmick && (
            <span className={`tag ${record.gimmick.status === 'CLEARED' ? 'ok' : 'warn'}`}>
              {record.gimmick.label} · {record.gimmick.status === 'CLEARED' ? '해제' : '실패'}
            </span>
          )}
          <span className="tag">총 획득 {earned} P</span>
        </div>

        <p className="hint" style={{ marginTop: 12 }}>
          공개분입니다 — 소지금 잔액과 가방은 담기지 않습니다.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel-title">PAIRS · 참가 페어 {record.pairs.length}</h2>
        <div className="preview">
          <table className="preview-table">
            <thead>
              <tr>
                <th>페어</th>
                <th>헌터</th>
                <th>성좌</th>
                <th>HP</th>
                <th>계약</th>
                <th>획득</th>
              </tr>
            </thead>
            <tbody>
              {record.pairs.map((pair) => (
                <tr key={pair.pairId}>
                  <td>{pair.label}</td>
                  <td>{pair.hunterName}</td>
                  <td>{pair.constellationName}</td>
                  <td className="num">
                    {pair.hunterHp}/{pair.hunterMaxHp}
                    <small className="dim"> {pair.injury}</small>
                  </td>
                  <td>
                    {pair.contract.stage}
                    <small className="dim"> {pair.contract.value}</small>
                  </td>
                  <td className="num gold">+{pair.pointsEarned}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {record.log.length > 0 && (
        <section className="panel">
          <h2 className="panel-title">ROLEPLAY · 연출 로그 {record.log.length}</h2>
          <div className="roleplay-list">
            {record.log.map((entry) => (
              <article key={entry.id} className="roleplay-block">
                <div className="roleplay-head">
                  <span className="field-label num">[{entry.at}]</span>
                </div>
                <pre className="roleplay-text">{entry.text}</pre>
              </article>
            ))}
          </div>
        </section>
      )}

      <footer className="console-foot">
        <span>HUNTER MANAGEMENT AGENCY · RAID RECORD</span>
        <a href={`${base()}/battle/board/`}>명부 게시판 →</a>
      </footer>
    </div>
  );
}
