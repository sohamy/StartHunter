/**
 * 공략 기록 보관 탭.
 *
 * 끝난 전투를 기록으로 남기고, 그 기록의 포인트와 남은 보급품을
 * 참가자 시트에 되돌려 준다(정산). 정산은 **전투 종료 시점 값으로 덮는 것**이라
 * 두 번 하면 그 뒤에 산 물건이 되돌아간다 — 그래서 매번 되묻는다.
 */

import { findItem } from '../../config/items';
import { settle, type SettlementTarget } from '../../engine/record';
import Collapsible from '../Collapsible';
import { useOps } from './OpsContext';
import { confirmed, shortTime } from './shared';
import type { SheetRecord } from '../../store';
import type { BattleRecord, BattleState, PairBond } from '../../types';

export default function ArchiveTab({
  battle,
  records,
  sheets,
  bonds,
  archiveBattle,
}: {
  battle: BattleState | null;
  records: BattleRecord[];
  sheets: SheetRecord[];
  bonds: PairBond[];
  /** 보관은 자동 보관 효과도 함께 쓰므로 작전실 본체가 들고 있다 */
  archiveBattle: (state: BattleState, silent?: boolean) => Promise<void>;
}) {
  const { storage, accounts, audit, busy, guard, refresh, setMessage, copyText } = useOps();

  /**
   * 기록의 포인트와 소모된 보급품을 **개인 시트**에 반영한다.
   * 소지금과 가방은 개인 소유라 페어가 아니라 사람마다 반영한다.
   */
  const settleRecord = async (record: BattleRecord) => {
    const targets: SettlementTarget[] = sheets.map((row) => ({
      accountId: row.accountId,
      side: row.sheet.side,
      points: row.sheet.points ?? 0,
      inventory: row.sheet.inventory ?? [],
    }));

    const result = settle(record, bonds, targets);
    if (result.rows.length === 0) {
      setMessage('정산할 항목이 없습니다 — 얻은 포인트가 없거나 시트를 불러오지 못했습니다.');
      return;
    }
    // 정산은 전투가 끝난 시점의 값을 시트에 맞춰 쓴다 — 이미 한 기록을 다시 하면
    // 그 뒤에 산 물건과 받은 소지금이 그 시점으로 되돌아간다. 먼저 알린다.
    const again = record.note.includes('[정산 완료]');
    if (
      !confirmed(
        (again ? '이미 정산한 기록입니다 — 다시 하면 전투 종료 시점 값으로 되돌립니다.\n\n' : '') +
          `${result.rows.length}명의 소지금과 가방을 전투 종료 시점 값으로 맞춥니다.\n` +
          result.rows
            .map(
              (row) =>
                `${row.name} (${row.label}) 소지금 ${row.pointsBefore} → ${row.pointsAfter}` +
                (row.earned > 0 ? ` (이 전투 지급 +${row.earned})` : ''),
            )
            .join('\n'),
      )
    ) {
      return;
    }

    await guard(async () => {
      const changed = new Set(result.rows.map((row) => row.accountId));
      for (const target of result.targets) {
        if (!changed.has(target.accountId)) continue;
        const owner = sheets.find((row) => row.accountId === target.accountId);
        if (!owner) continue;
        await accounts.updateSheet(target.accountId, {
          ...owner.sheet,
          points: target.points,
          inventory: target.inventory,
        });

        /*
           정산은 사람마다 한 줄씩 남긴다.
           한 덩이로 남기면 「누구의 소지금이 얼마에서 얼마로」를 되짚을 수 없고,
           정산은 두 번 하면 값이 되돌아가는 조작이라 특히 근거가 필요하다.
        */
        const row = result.rows.find((candidate) => candidate.accountId === target.accountId);
        try {
          await audit.record({
            targetAccountId: target.accountId,
            targetName: owner.sheet.name,
            action: 'SETTLE',
            summary: `${record.operation.name} 정산${row && row.earned > 0 ? ` — 이 전투 지급 +${row.earned} P` : ''}`,
            reason: again ? '재정산 (전투 종료 시점 값으로 되돌림)' : null,
            before: row?.pointsBefore ?? null,
            after: row?.pointsAfter ?? null,
          });
        } catch {
          // 기록이 안 남아도 정산은 이미 끝났다 — 여기서 멈추면 반만 반영된다
        }
      }
      await storage.saveRecord({
        ...record,
        note: `${record.note}\n[정산 완료]`.trim(),
      });
      await refresh();
      setMessage(
        `정산 완료 — ${result.rows
          .map((row) => `${row.name} ${row.pointsBefore} → ${row.pointsAfter}P`)
          .join(' · ')}`,
      );
    });
  };

  const removeRecord = async (record: BattleRecord) => {
    if (!confirmed(`${record.operation.name} 기록을 삭제합니다.`)) return;
    await guard(async () => {
      await storage.deleteRecord(record.id);
      await refresh();
      setMessage('기록을 삭제했습니다.');
    });
  };

  return (
    <>
      <section className="panel">
        <div className="process-head">
          <h2 className="panel-title">공략 기록 보관</h2>
          <span className="hint">
            끝난 전투는 기록으로 남습니다. 정산을 누르면 전투에서 얻은 포인트와 남은 보급품이
            영구 편성에 반영됩니다.
          </span>
        </div>

        {battle && (battle.status === 'CLEARED' || battle.status === 'FAILED') && (
          <button
            type="button"
            className="ctl wide"
            disabled={busy}
            onClick={() => void archiveBattle(battle)}
          >
            지금 열려 있는 전투를 기록으로 보관 — {battle.operation.name} ·{' '}
            {battle.status === 'CLEARED' ? '클리어' : '실패'}
          </button>
        )}

        {records.length === 0 ? (
          <p className="dim">보관된 기록이 없습니다.</p>
        ) : (
          <div className="record-list">
            {records.map((record) => {
              const earned = record.pairs.reduce((sum, row) => sum + row.pointsEarned, 0);
              const settled = record.note.includes('[정산 완료]');

              return (
                <article className="panel record" key={record.id}>
                  <header className="process-head">
                    <div>
                      <b>{record.operation.name}</b>{' '}
                      <span className="dim">
                        {record.operation.floor}층 · 위협도 {record.operation.threatLevel} ·{' '}
                        {record.mode}
                      </span>
                      <div className="dim small-text">
                        {shortTime(record.finishedAt)} · {record.rounds} 라운드
                        {record.bossName ? ` · ${record.bossName}` : ''}
                      </div>
                    </div>
                    <div className="btn-row">
                      <span
                        className={`tag ${record.status === 'CLEARED' ? 'ok' : 'critical'}`}
                      >
                        {record.status === 'CLEARED' ? '클리어' : '실패'}
                      </span>
                      {record.gimmick && (
                        <span
                          className={`tag ${
                            record.gimmick.status === 'CLEARED' ? 'ok' : 'warn'
                          }`}
                        >
                          {record.gimmick.label} · {record.gimmick.status}
                        </span>
                      )}
                      <span className="tag gold">총 {earned}P</span>
                      {settled && <span className="tag ok">정산 완료</span>}
                    </div>
                  </header>

                  <table className="preview-table">
                    <thead>
                      <tr>
                        <th>페어</th>
                        <th>헌터</th>
                        <th>성좌</th>
                        <th>HP</th>
                        <th>계약</th>
                        <th>획득</th>
                        <th>보유</th>
                        <th>남은 보급품</th>
                      </tr>
                    </thead>
                    <tbody>
                      {record.pairs.map((row) => (
                        <tr key={row.pairId}>
                          <td>{row.label}</td>
                          <td>{row.hunterName}</td>
                          <td>{row.constellationName}</td>
                          <td className="num">
                            {row.hunterHp}/{row.hunterMaxHp}
                            <small className="dim"> {row.injury}</small>
                          </td>
                          <td>
                            {row.contract.stage}
                            <small className="dim"> {row.contract.value}</small>
                          </td>
                          <td className="num gold">+{row.pointsEarned}</td>
                          <td className="num">{row.pointsTotal}</td>
                          <td>
                            {row.inventory.length === 0 ? (
                              <span className="dim">없음</span>
                            ) : (
                              row.inventory.map((stack) => (
                                <span key={stack.itemId} className="tag">
                                  {findItem(stack.itemId)?.nameKo ?? stack.itemId} ×
                                  {stack.quantity}
                                </span>
                              ))
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="btn-row">
                    <button
                      type="button"
                      className="ctl small on"
                      disabled={busy || earned === 0}
                      onClick={() => void settleRecord(record)}
                    >
                      편성에 정산 반영
                    </button>
                    <button
                      type="button"
                      className="ctl small"
                      onClick={() =>
                        void copyText(
                          record.log.map((entry) => `[${entry.at}] ${entry.text}`).join('\n'),
                        )
                      }
                    >
                      로그 복사
                    </button>
                    <button
                      type="button"
                      className="ctl small"
                      disabled={busy}
                      onClick={() => void removeRecord(record)}
                    >
                      삭제
                    </button>
                  </div>

                  <Collapsible label={`전투 로그 · ${record.log.length}건`}>
                    <ol className="log-list">
                      {record.log.slice(-120).map((entry) => (
                        <li key={entry.id}>
                          <span className="log-time num">[{entry.at}]</span>
                          <span className="log-text">
                            {entry.text}
                            {entry.detail && <small className="dim">{entry.detail}</small>}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </Collapsible>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
