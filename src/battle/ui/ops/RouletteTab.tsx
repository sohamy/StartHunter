/**
 * 룰렛 원반 탭.
 *
 * 원반을 열고 닫고, 전광판(회전 기록)을 정리한다.
 * 어느 칸에 걸리는지는 서버가 뽑는다 — 이 화면은 무엇을 걸 수 있게 할지만 정한다.
 */

import RouletteEditor from '../RouletteEditor';
import { useOps } from './OpsContext';
import { confirmed } from './shared';
import type { RouletteSpin, RouletteWheel } from '../../types';

export default function RouletteTab({
  wheels,
  spins,
}: {
  wheels: RouletteWheel[];
  spins: RouletteSpin[];
}) {
  const { storage, busy, guard, refresh, setMessage } = useOps();

  const saveWheel = async (wheel: RouletteWheel) => {
    await guard(async () => {
      await storage.saveRouletteWheel(wheel);
      await refresh();
      setMessage(`원반을 반영했습니다 — ${wheel.name}`);
    });
  };

  const removeWheel = async (id: string) => {
    await guard(async () => {
      await storage.deleteRouletteWheel(id);
      await refresh();
      setMessage('원반을 지웠습니다.');
    });
  };

  /**
   * 회전 기록 지우기.
   *
   * 기록은 전광판이지 정산 근거가 아니다 — 소지금은 돌릴 때 이미 옮겨졌으므로
   * 지워도 지갑은 그대로다. 회차가 끝나면 전광판을 비우는 용도로 쓴다.
   */
  const removeSpin = async (spin: RouletteSpin) => {
    if (!confirmed(`${spin.spinnerName} 의 회전 기록 한 줄을 지웁니다.`)) return;
    await guard(async () => {
      await storage.deleteRouletteSpin(spin.id);
      await refresh();
      setMessage('회전 기록을 지웠습니다.');
    });
  };

  const clearSpins = async () => {
    if (!confirmed(`회전 기록 ${spins.length}건을 모두 지웁니다. 소지금은 그대로입니다.`)) return;
    await guard(async () => {
      await storage.clearRouletteSpins();
      await refresh();
      setMessage('회전 기록을 비웠습니다.');
    });
  };

  return (
    <section className="panel">
      <div className="process-head">
        <h2 className="panel-title">룰렛 원반 · {wheels.length}</h2>
        <button type="button" className="ctl small" onClick={() => void refresh()}>
          새로 고침
        </button>
      </div>
      <p className="hint" style={{ marginBottom: 14 }}>
        여기서 연 원반은 도박장(<code>/battle/roulette/</code>)에 바로 뜹니다. 상점과는 다른
        화면입니다. 참가비를 받고 돌려서, 걸린 칸에 적힌 만큼 소지금을 지급합니다 —
        <b> 어느 칸에 걸리는지는 서버가 뽑습니다.</b> 참가자 화면은 정해진 결과를 따라 돌 뿐이라
        브라우저를 고쳐도 결과는 바뀌지 않습니다.
      </p>
      <RouletteEditor
        wheels={wheels}
        busy={busy}
        onSave={(wheel) => void saveWheel(wheel)}
        onDelete={(id) => void removeWheel(id)}
      />

      {/* ── 회전 기록 ── */}
      <div className="process-head" style={{ marginTop: 22 }}>
        <h3 className="sub-title">회전 기록 · {spins.length}</h3>
        <button
          type="button"
          className="ctl small"
          disabled={busy || spins.length === 0}
          onClick={() => void clearSpins()}
        >
          전부 비우기
        </button>
      </div>
      <p className="hint" style={{ marginBottom: 10 }}>
        도박장 전광판에 뜨는 줄입니다. 지워도 <b>소지금은 그대로입니다</b> — 기록은 정산
        근거가 아니라 게시물입니다. 회차가 끝나면 비워서 새 회차를 시작하세요.
      </p>
      {spins.length === 0 ? (
        <p className="hint">아직 돌린 기록이 없습니다.</p>
      ) : (
        <div className="preview">
          <table className="preview-table">
            <thead>
              <tr>
                <th>시각</th>
                <th>돌린 사람</th>
                <th>원반</th>
                <th>걸린 칸</th>
                <th>손익</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {spins.map((spin) => (
                <tr key={spin.id}>
                  <td className="dim">{new Date(spin.at).toLocaleString('ko-KR')}</td>
                  <td>{spin.spinnerName}</td>
                  <td className="dim">{spin.wheelName}</td>
                  <td>{spin.label}</td>
                  <td className={`num ${spin.net > 0 ? 'gold' : 'dim'}`}>
                    {spin.net > 0 ? '+' : ''}
                    {spin.net} P
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ctl small"
                      disabled={busy}
                      onClick={() => void removeSpin(spin)}
                    >
                      지우기
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
