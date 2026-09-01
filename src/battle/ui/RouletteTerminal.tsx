/**
 * 포인트 도박장 단말 — 참가자용.
 *
 * `/battle/roulette/` 으로 연다. 보급 상점과는 다른 곳이다 —
 * 상점은 관리국 창구고 여기는 관리국이 눈감아 주는 뒷골목이다.
 *
 * 참가비를 내고 원반을 돌린다. 멈춘 칸에 적힌 만큼 소지금을 받는다.
 * 칸도 확률도 참가비도 운영진이 작전실에서 정한다.
 *
 * **어느 칸에 걸렸는지는 서버(`roulette_spin`)가 정한다.**
 * 이 화면의 회전은 이미 정해진 결과를 뒤늦게 따라 도는 연출일 뿐이다 —
 * 돌리는 도중에 새로고침해도 결과는 이미 서버에 적혀 있다.
 */

import { useCallback, useMemo, useState } from 'react';

import { ROULETTE_NPC } from '../config/npc';
import { chanceOf, chanceText, expectedNet, totalWeight } from '../engine/roulette';
import { getAccounts, getRoulette } from '../store';
import NpcCard from './NpcCard';
import TerminalNav from './TerminalNav';
import { useAccountSession } from './useAccountSession';
import type { RouletteSlot, RouletteSpin, RouletteWheel } from '../types';
import type { SpinOutcome } from '../store';

/** 원반이 도는 시간. CSS 전환 시간과 같아야 한다 */
const SPIN_MS = 4200;
/** 결과 칸 앞에서 몇 바퀴를 더 도는지 */
const SPIN_TURNS = 6;

function joinUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/battle/join/`;
}

function shopUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/battle/shop/`;
}

/**
 * 칸의 등급 — 색을 가르는 데만 쓴다.
 * 참가비를 기준으로 본다. 참가비보다 적게 주는 칸은 걸려도 손해다.
 */
function tierOf(slot: RouletteSlot, fee: number): string {
  const payout = Math.max(0, slot.payout ?? 0);
  if (payout <= 0) return 'dud';
  if (payout < fee) return 'low';
  if (payout < Math.max(fee, 1) * 3) return 'mid';
  return 'top';
}

/** 원 위의 한 점 — 0도가 12시, 시계 방향 */
function pointAt(angle: number, radius: number): [number, number] {
  const radian = (angle * Math.PI) / 180;
  return [100 + radius * Math.sin(radian), 100 - radius * Math.cos(radian)];
}

/** 칸 하나의 부채꼴 경로 */
function wedgePath(start: number, end: number, radius: number): string {
  const [x1, y1] = pointAt(start, radius);
  const [x2, y2] = pointAt(end, radius);
  const large = end - start > 180 ? 1 : 0;
  return `M 100 100 L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

/**
 * 칸 이름을 원반에 어떻게 앉힐지 — 칸의 폭(각도)이 정한다.
 *
 * 이름을 원 둘레 방향(가로)으로 눕히면 좁은 칸에서 옆 칸 글자와 겹친다.
 * 그래서 **반지름 방향**으로 세워 적는다 — 글자가 차지하는 둘레 폭이 글자 높이만큼으로
 * 줄어들어, 칸이 좁아도 서로 밀지 않는다. 그래도 모자라는 아주 좁은 칸은 이름을 비운다
 * (밑의 칸 목록에 이름 · 배당 · 확률이 그대로 적혀 있다).
 */
interface LabelPlan {
  /** 글자 크기 (viewBox 200 기준) */
  size: number;
  /** 글자가 시작하는 반지름 — 좁은 칸은 바깥으로 밀어 둘레를 넓게 쓴다 */
  from: number;
  /** 넘치는 이름은 잘라 낸다 */
  maxChars: number;
}

function labelPlan(span: number): LabelPlan | null {
  if (span >= 24) return { size: 9, from: 30, maxChars: 8 };
  if (span >= 13) return { size: 8, from: 36, maxChars: 7 };
  if (span >= 7) return { size: 7, from: 46, maxChars: 5 };
  return null;
}

function clipLabel(label: string, maxChars: number): string {
  const text = label.trim();
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

/** 무게에 비례한 각도 — 그림과 확률이 어긋나면 화면이 거짓말을 하게 된다 */
function arcsOf(slots: RouletteSlot[]): Array<{ start: number; end: number; mid: number }> {
  const total = totalWeight(slots);
  if (total <= 0) {
    // 무게가 하나도 없으면 균등하게 그린다 — 어차피 돌아가지 않는 원반이다
    const step = 360 / Math.max(slots.length, 1);
    return slots.map((_, index) => ({
      start: index * step,
      end: (index + 1) * step,
      mid: (index + 0.5) * step,
    }));
  }

  let cursor = 0;
  return slots.map((slot) => {
    const span = (Math.max(0, slot.weight ?? 0) / total) * 360;
    const start = cursor;
    cursor += span;
    return { start, end: cursor, mid: start + span / 2 };
  });
}

export default function RouletteTerminal() {
  const accounts = useMemo(() => getAccounts(), []);
  /* 원반 · 전광판 · 돌리기가 한 곳에서 온다 — 예전에는 앞의 둘이 storage, 뒤가 accounts 였다 */
  const roulette = useMemo(() => getRoulette(), []);

  /** 부팅은 단말 공통이다 — 창구라 배치 여부까지 함께 본다. 원반과 전광판만 여기서 더 싣는다 */
  const { phase, account, setAccount, deployed, refreshDeployment } = useAccountSession({
    deployment: true,
    onReady: async (_found, stopped) => {
      try {
        const rows = (await roulette.listWheels()).filter((wheel) => wheel.active);
        if (stopped()) return;
        setWheels(rows);
        setPickedId(rows[0]?.id ?? '');
      } catch (failure) {
        if (!stopped()) {
          setError(failure instanceof Error ? failure.message : '원반을 불러오지 못했습니다.');
        }
      }
      await refreshBoard();
    },
  });

  const [wheels, setWheels] = useState<RouletteWheel[]>([]);
  const [pickedId, setPickedId] = useState<string>('');
  const [board, setBoard] = useState<RouletteSpin[]>([]);

  /** 원반이 지금까지 돈 각도 — 줄어들지 않게 계속 더한다 */
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SpinOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshBoard = useCallback(async () => {
    try {
      setBoard(await roulette.recentSpins(20));
    } catch {
      // 전광판이 안 떠도 원반은 돌아간다 — 여기서 화면을 멈추지 않는다
    }
  }, [roulette]);


  const wheel = wheels.find((row) => row.id === pickedId) ?? null;
  const sheet = account?.sheet ?? null;
  const points = sheet?.points ?? 0;
  const arcs = wheel ? arcsOf(wheel.slots) : [];

  const spin = useCallback(async () => {
    if (!account || !wheel || spinning) return;
    setError(null);
    setResult(null);

    const joined = await refreshDeployment(account.id);
    if (joined) {
      setError('전투에 배치된 동안에는 돌릴 수 없습니다. 전투가 끝난 뒤에 오세요.');
      return;
    }

    setSpinning(true);
    let outcome: SpinOutcome;
    try {
      // 결과는 여기서 이미 정해진다 — 아래 회전은 그것을 따라가는 연출이다
      outcome = await roulette.spin(wheel.id);
    } catch (failure) {
      setSpinning(false);
      setError(failure instanceof Error ? failure.message : '돌리지 못했습니다.');
      return;
    }

    // 걸린 칸이 위쪽 바늘 아래로 오도록 돌린다. 칸 안에서 조금씩 어긋나게 두어
    // 매번 같은 자리에 딱 멈추지 않게 한다.
    const arc = arcs[outcome.slotIndex] ?? { start: 0, end: 0, mid: 0 };
    const jitter = (Math.random() - 0.5) * (arc.end - arc.start) * 0.6;
    const target = -(arc.mid + jitter);
    const forward = ((target - rotation) % 360 + 360) % 360;
    setRotation(rotation + SPIN_TURNS * 360 + forward);

    window.setTimeout(() => {
      setResult(outcome);
      setSpinning(false);
      setAccount((current) =>
        current ? { ...current, sheet: { ...current.sheet, points: outcome.points } } : current,
      );
      void refreshBoard();
    }, SPIN_MS);
  }, [account, arcs, accounts, refreshBoard, rotation, spinning, wheel]);

  if (phase === 'LOADING') {
    return <div className="console-loading">OPENING FORTUNE HALL…</div>;
  }

  const fee = wheel?.entryFee ?? 0;
  const broke = points < fee;
  const closed = deployed !== null;

  /** 딜러가 무슨 말을 할지 — 방금 무슨 일이 있었는지를 아는 이 화면이 정한다 */
  const npcMood = closed ? 'CLOSED' : spinning ? 'IDLE' : result ? (result.net > 0 ? 'OK' : 'BAD') : 'IDLE';
  const npcLineOverride = spinning
    ? '돌아갑니다. 끝날 때까지는 저도 결과를 모릅니다.'
    : broke && !closed && wheel
      ? '참가비가 모자랍니다. 외상은 안 받습니다 — 관리국에서 벌어 오세요.'
      : null;

  return (
    <div className="console">
      <TerminalNav
        current="roulette"
        who={sheet ? { name: sheet.name, side: sheet.side } : null}
      />
      <header className="console-head">
        <div className="agency">
          <b>FORTUNE HALL</b>
          <span>운명 도박장 · 별자리 회전반</span>
        </div>
        <span className={`tag ${closed ? 'critical' : 'ok'}`}>
          {closed ? '문 닫음 — 전투 배치 중' : '문 열림'}
        </span>
      </header>

      <section className="panel hall">
        <NpcCard
          npc={ROULETTE_NPC}
          mood={npcMood}
          seed={board.length + (result?.payout ?? 0)}
          line={npcLineOverride}
        />
      </section>

      {sheet ? (
        <section className="panel">
          <div className="process-head">
            <h2 className="panel-title">
              {sheet.name}
              <span
                className={`tag ${sheet.side === 'HUNTER' ? 'blue' : 'gold'}`}
                style={{ marginLeft: 10 }}
              >
                {sheet.side === 'HUNTER' ? '헌터' : '성좌'}
              </span>
            </h2>
            <span className={`tag ${closed ? 'critical' : 'ok'}`}>
              {closed ? '문 닫음 — 전투 배치 중' : '문 열림'}
            </span>
          </div>
          <p className="wallet-line">
            소지금 <b className="num gold">{points} P</b>
            {wheel && (
              <>
                <span className="dim"> · 참가비 </span>
                <b className="num">{fee} P</b>
              </>
            )}
          </p>
          {closed && (
            <p className="notice warn" style={{ marginTop: 10 }}>
              <b>{deployed?.operation.name}</b> 에 배치되어 있습니다 — 전투가 끝날 때까지 원반을
              돌릴 수 없습니다.
            </p>
          )}
          {error && (
            <p className="notice warn" style={{ marginTop: 10 }}>
              {error}
            </p>
          )}
        </section>
      ) : (
        <section className="panel">
          <h2 className="panel-title">구경만 하고 있습니다</h2>
          <p className="hint" style={{ marginBottom: 12 }}>
            접속하면 소지금과 원반이 함께 뜹니다.
          </p>
          <a className="confirm-btn" href={joinUrl()}>
            접속하기
            <small>계약 등록 단말로 이동</small>
          </a>
        </section>
      )}

      {sheet && wheels.length === 0 && (
        <section className="panel">
          <h2 className="panel-title">지금은 돌아가는 원반이 없습니다</h2>
          <p className="dim">
            운영진이 작전실에서 원반을 열면 여기에 뜹니다. 칸도 확률도 참가비도 그쪽에서 정합니다.
          </p>
        </section>
      )}

      {sheet && wheel && (
        <section className="panel wheel-panel">
          <div className="process-head">
            <h2 className="panel-title">{wheel.name}</h2>
            {wheels.length > 1 && (
              <select
                className="ctl input wheel-pick"
                value={pickedId}
                disabled={spinning}
                onChange={(event) => {
                  setPickedId(event.target.value);
                  setResult(null);
                }}
              >
                {wheels.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} · 참가비 {row.entryFee} P
                  </option>
                ))}
              </select>
            )}
          </div>

          {wheel.description && <p className="hint">{wheel.description}</p>}

          <div className="wheel-stage">
            <div className="wheel-box">
              <div className="wheel-needle" aria-hidden="true" />
              <svg
                className="wheel-svg"
                viewBox="0 0 200 200"
                role="img"
                aria-label={`${wheel.name} 원반`}
              >
                <defs>
                  {/* 놋쇠 테 — 위쪽이 밝고 아래쪽이 어두워 원반이 세워져 있는 것처럼 보인다 */}
                  <linearGradient id="wheel-rim" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f0d79b" />
                    <stop offset="45%" stopColor="#8d7238" />
                    <stop offset="100%" stopColor="#5d4a22" />
                  </linearGradient>
                  {/* 가운데는 그대로 두고 테두리만 어둡게 깔아 두께를 만든다 */}
                  <radialGradient id="wheel-shade" cx="50%" cy="42%" r="62%">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.14" />
                    <stop offset="62%" stopColor="#ffffff" stopOpacity="0" />
                    <stop offset="100%" stopColor="#000000" stopOpacity="0.42" />
                  </radialGradient>
                </defs>

                <circle className="wheel-rim" cx="100" cy="100" r="98" />
                <circle className="wheel-rim-inner" cx="100" cy="100" r="93" />

                <g
                  style={{
                    transform: `rotate(${rotation}deg)`,
                    transformOrigin: '100px 100px',
                    transition: spinning
                      ? `transform ${SPIN_MS}ms cubic-bezier(.12,.72,.12,1)`
                      : 'none',
                  }}
                >
                  {wheel.slots.length === 1 ? (
                    <circle className="wheel-slice tier-top" cx="100" cy="100" r="90" />
                  ) : (
                    wheel.slots.map((slot, index) => (
                      <path
                        key={`${slot.label}-${index}`}
                        className={`wheel-slice tier-${tierOf(slot, fee)} ${
                          index % 2 ? 'alt' : ''
                        } ${result?.slotIndex === index && !spinning ? 'hit' : ''}`}
                        d={wedgePath(arcs[index].start, arcs[index].end, 90)}
                      />
                    ))
                  )}

                  {/* 칸 경계마다 못을 박는다 — 회전이 눈에 보이게 하는 표식이다 */}
                  {wheel.slots.length > 1 &&
                    arcs.map((arc, index) => {
                      const [x, y] = pointAt(arc.start, 84);
                      return <circle key={`peg-${index}`} className="wheel-peg" cx={x} cy={y} r="1.8" />;
                    })}

                  {wheel.slots.map((slot, index) => {
                    const arc = arcs[index];
                    const plan = labelPlan(arc.end - arc.start);
                    if (!plan) return null;
                    // 반지름 방향으로 세워 적는다 — 가운데에서 바깥으로 읽는다
                    const y = 100 - plan.from;
                    return (
                      <text
                        key={`label-${index}`}
                        className="wheel-label"
                        x={100}
                        y={y}
                        fontSize={plan.size}
                        transform={`rotate(${arc.mid} 100 100) rotate(-90 100 ${y})`}
                        textAnchor="start"
                        dominantBaseline="central"
                      >
                        {clipLabel(slot.label, plan.maxChars)}
                      </text>
                    );
                  })}
                </g>

                {/* 그림자는 원반과 함께 돌지 않는다 — 빛은 늘 같은 곳에서 온다 */}
                <circle className="wheel-shade" cx="100" cy="100" r="90" />

                <circle className="wheel-hub" cx="100" cy="100" r="16" />
                <circle className="wheel-hub-ring" cx="100" cy="100" r="11" />
                <text className="wheel-hub-mark" x="100" y="100" textAnchor="middle" dominantBaseline="central">
                  ✦
                </text>
              </svg>
            </div>

            <div className="wheel-side">
              <button
                type="button"
                className="ctl primary wheel-go"
                disabled={spinning || closed || broke || totalWeight(wheel.slots) <= 0}
                title={
                  closed
                    ? '전투에 배치된 동안에는 돌릴 수 없습니다'
                    : broke
                      ? '참가비가 모자랍니다'
                      : undefined
                }
                onClick={() => void spin()}
              >
                {spinning ? '돌아가는 중…' : `돌리기 −${fee} P`}
              </button>

              {result ? (
                <div className={`wheel-result ${result.net > 0 ? 'win' : 'lose'}`}>
                  <span className="dim">멈춘 칸</span>
                  <b className="wheel-result-label">{result.label}</b>
                  <span className="num">
                    +{result.payout} P · 참가비 −{result.fee} P
                  </span>
                  <b className={`num ${result.net > 0 ? 'gold' : 'danger-text'}`}>
                    {result.net > 0 ? `+${result.net}` : result.net} P
                  </b>
                  <span className="dim">남은 소지금 {result.points} P</span>
                </div>
              ) : (
                <p className="dim wheel-idle">
                  참가비를 내고 한 번 돌립니다. 멈춘 칸에 적힌 만큼 소지금으로 받습니다.
                </p>
              )}

              <p className="hint wheel-ev">
                한 번 돌릴 때 평균 손익{' '}
                <b className={expectedNet(wheel) >= 0 ? 'gold' : 'danger-text'}>
                  {expectedNet(wheel) >= 0 ? '+' : ''}
                  {expectedNet(wheel).toFixed(1)} P
                </b>{' '}
                — 확률대로 오래 돌렸을 때의 값입니다. 한 판의 결과는 여기에 매이지 않습니다.
              </p>
            </div>
          </div>

          <ul className="slot-list">
            {wheel.slots.map((slot, index) => (
              <li
                key={`row-${index}`}
                className={`slot-row tier-${tierOf(slot, fee)} ${
                  result?.slotIndex === index ? 'hit' : ''
                }`}
              >
                <span className="slot-label">{slot.label}</span>
                <span className="num slot-payout">+{Math.max(0, slot.payout ?? 0)} P</span>
                <span className="num slot-chance">{chanceText(wheel.slots, index)}</span>
                <span className="slot-bar" aria-hidden="true">
                  <i style={{ width: `${(chanceOf(wheel.slots, index) * 100).toFixed(1)}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sheet && board.length > 0 && (
        <section className="panel">
          <h2 className="panel-title">전광판 · 최근 {board.length}회</h2>
          <ul className="spin-board">
            {board.map((row) => (
              <li key={row.id} className={row.net > 0 ? 'win' : ''}>
                <b className="spin-who">{row.spinnerName}</b>
                <span className="dim">{row.wheelName}</span>
                <span className="spin-slot">{row.label}</span>
                <span className={`num ${row.net > 0 ? 'gold' : 'dim'}`}>
                  {row.net > 0 ? `+${row.net}` : row.net} P
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="console-foot">
        <span>FORTUNE HALL · 운명 도박장</span>
        <a href={shopUrl()}>← 보급 상점</a>
      </footer>
    </div>
  );
}
