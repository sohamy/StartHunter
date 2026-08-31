/**
 * 보스 패턴 편집 — 운영진 전용.
 *
 * 세 덩어리로 나뉜다.
 *   1. 페이즈 계획 — 페이즈가 넘어가는 HP 지점을 정한다
 *   2. 진행표     — 페이즈별로 몇 라운드에 무엇이 나오는지 저장 전에 확인한다
 *   3. 공격 목록  — 공격을 하나씩 만들고 발동 조건(페이즈 · 라운드 주기 · HP)을 붙인다
 *
 * 조건이 붙은 공격은 조건이 맞는 라운드에 위에서부터 우선 발동하고,
 * 조건이 없는 공격은 남은 라운드를 순서대로 돌아간다.
 * 공격을 하나라도 만들면 프리셋 패턴 세트는 쓰지 않는다.
 *
 * 여기서 만든 값은 `engine/enemy.ts` 가 패턴 정의로 바꿔 쓰므로,
 * 라운드 처리 쪽은 프리셋과 커스텀을 구분하지 않는다.
 */

import { STATUS_DEFINITIONS } from '../config/status';
import {
  describePhaseBands,
  normalizeCutoffs,
  patternSchedule,
  phaseBands,
} from '../engine/enemy';
import { newUuid } from '../engine/id';
import type { CustomAttack } from '../types';

/** 새 공격의 시작값 — 바로 쓸 수 있는 단일 공격 */
export function blankAttack(order: number): CustomAttack {
  return {
    id: newUuid(),
    name: `공격 ${order + 1}`,
    description: '',
    powerRatio: 1,
    aoe: false,
    applyStatusIds: [],
    selfStatusIds: [],
    revealed: true,
    telegraphRounds: 0,
    telegraphMessage: '',
    phases: [],
    every: 0,
    offset: 0,
    hpBelowPercent: null,
  };
}

/** 주기 · 자리로 실제 발동 라운드를 적는다 — 숫자만 보고는 감이 오지 않는다 */
function everyHint(every: number, offset: number): string {
  if (every < 2) return '조건 없음 — 순서대로 돌아갑니다';
  const rounds: number[] = [];
  for (let round = 1; round <= 24 && rounds.length < 3; round += 1) {
    if (round % every === ((offset % every) + every) % every) rounds.push(round);
  }
  return `${rounds.join(' · ')} … 라운드`;
}

function NumberInput({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}) {
  return (
    <label className="num-field">
      <span className="field-label">{label}</span>
      <input
        className="ctl input tiny"
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (!Number.isNaN(parsed)) onChange(parsed);
        }}
      />
      {hint && <small className="dim">{hint}</small>}
    </label>
  );
}

export default function AttackEditor({
  attacks,
  maxPhase,
  enemyAttack,
  maxHp,
  phaseCutoffs,
  patternSetId,
  onChange,
  onPhaseCutoffs,
  onImportPreset,
  presetLabel,
}: {
  attacks: CustomAttack[];
  /** 페이즈 선택 범위 */
  maxPhase: number;
  /** 계수 안내에 쓰는 적 공격력 */
  enemyAttack: number;
  /** 진행표의 HP 조건 판정에 쓴다 */
  maxHp?: number;
  /** 페이즈 전환 HP 경계. 비어 있으면 프리셋 · 균등 분할을 따른다 */
  phaseCutoffs?: number[];
  patternSetId?: string | null;
  onChange: (next: CustomAttack[]) => void;
  /** 넘기면 페이즈 경계를 여기서 편집할 수 있다 */
  onPhaseCutoffs?: (next: number[]) => void;
  /** 넘기면 프리셋을 편집 가능한 공격 목록으로 펼치는 버튼이 나온다 */
  onImportPreset?: () => void;
  presetLabel?: string;
}) {
  const patch = (index: number, next: Partial<CustomAttack>) => {
    onChange(attacks.map((attack, i) => (i === index ? { ...attack, ...next } : attack)));
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= attacks.length) return;
    const next = [...attacks];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const toggleStatus = (index: number, field: 'applyStatusIds' | 'selfStatusIds', defId: string) => {
    const current = attacks[index][field];
    patch(index, {
      [field]: current.includes(defId)
        ? current.filter((id) => id !== defId)
        : [...current, defId],
    });
  };

  const togglePhase = (index: number, phase: number) => {
    const current = attacks[index].phases;
    patch(index, {
      phases: current.includes(phase)
        ? current.filter((row) => row !== phase)
        : [...current, phase].sort((a, b) => a - b),
    });
  };

  const phases = Math.max(1, maxPhase);
  const source = { maxPhase: phases, phaseCutoffs, patternSetId, attacks, maxHp };

  /** 편집 중인 경계 — 저장된 값이 없으면 현재 적용되는 값(프리셋 · 균등 분할)을 보여 준다 */
  const cutoffs = normalizeCutoffs(
    (phaseCutoffs ?? []).length > 0
      ? phaseCutoffs
      : phaseBands(source)
          .filter((band) => band.minPercent > 0)
          .map((band) => band.minPercent),
    phases,
  );

  const schedule = patternSchedule(source, 6);

  /** 페이즈별로 몇 개가 걸려 있는지 — 빈 페이즈를 바로 알 수 있다 */
  const perPhase = Array.from({ length: phases }, (_, i) => {
    const phase = i + 1;
    return {
      phase,
      count: attacks.filter((attack) => attack.phases.length === 0 || attack.phases.includes(phase))
        .length,
    };
  });

  return (
    <div className="attack-editor">
      {onImportPreset && (
        <div className="attack-summary">
          <button type="button" className="ctl small" onClick={onImportPreset}>
            프리셋 불러오기
          </button>
          <span className="hint">
            {presetLabel
              ? `${presetLabel} 를 편집 가능한 공격 목록으로 펼칩니다 — 지금 목록은 지워집니다.`
              : '고른 프리셋 패턴을 편집 가능한 공격 목록으로 펼칩니다.'}
          </span>
        </div>
      )}

      {/* ── 페이즈 계획 ── */}
      {onPhaseCutoffs && phases > 1 && (
        <div className="phase-plan">
          <div className="attack-row">
            {cutoffs.map((value, index) => (
              <NumberInput
                key={index}
                label={`PHASE ${index + 1} → ${index + 2} 전환 HP%`}
                value={value}
                min={0}
                max={100}
                onChange={(next) => {
                  const edited = [...cutoffs];
                  edited[index] = Math.min(100, Math.max(0, next));
                  onPhaseCutoffs(normalizeCutoffs(edited, phases));
                }}
                hint={`HP ${value}% 아래로 떨어지면 PHASE ${index + 2}`}
              />
            ))}
          </div>
          <div className="attack-summary">
            <span className="hint">{describePhaseBands({ maxPhase: phases, phaseCutoffs: cutoffs })}</span>
            {(phaseCutoffs ?? []).length > 0 && (
              <button
                type="button"
                className="ctl small"
                title="직접 정한 경계를 버리고 프리셋 · 균등 분할로 돌아갑니다"
                onClick={() => onPhaseCutoffs([])}
              >
                기본값으로
              </button>
            )}
          </div>
        </div>
      )}

      <div className="attack-summary">
        {perPhase.map((row) => (
          <span key={row.phase} className={`tag ${row.count === 0 ? 'critical' : 'ok'}`}>
            PHASE {row.phase} · {row.count}개
          </span>
        ))}
        <span className="hint">
          조건이 걸린 공격이 먼저 나가고, 조건 없는 공격은 라운드마다 순서대로 돌아갑니다.
        </span>
      </div>

      {/* ── 진행표 ── */}
      {attacks.length > 0 && (
        <div className="pattern-schedule">
          <span className="field-label">진행표 — 라운드별 예상 패턴</span>
          {schedule.map((band) => (
            <div className="schedule-row" key={band.phase}>
              <span className="schedule-phase">
                {band.label}
                <small>HP ~{band.samplePercent}%</small>
              </span>
              {band.rounds.map((cell) => (
                <span
                  key={cell.round}
                  className={`schedule-cell ${cell.name ? '' : 'empty'} ${
                    cell.telegraph ? 'warn' : ''
                  } ${cell.conditional ? 'cond' : ''}`}
                  title={
                    cell.name
                      ? `${cell.round} 라운드 · ${cell.name}${cell.telegraph ? ' (예고)' : ''}`
                      : `${cell.round} 라운드 · 아무것도 하지 않습니다`
                  }
                >
                  <i>R{cell.round}</i>
                  <b>{cell.name ?? '—'}</b>
                </span>
              ))}
            </div>
          ))}
          <span className="hint">
            HP 조건은 각 페이즈 구간의 가운데 HP 를 기준으로 계산합니다. 예고 공격은 그 라운드에
            예고만 하고 지정한 라운드 뒤에 발동합니다.
          </span>
        </div>
      )}

      {attacks.length === 0 && (
        <p className="hint">
          만든 공격이 없습니다 — 아래 프리셋 패턴 세트를 그대로 씁니다. 공격을 하나라도 만들면
          이 목록만 사용합니다.
        </p>
      )}

      {attacks.map((attack, index) => {
        const every = attack.every ?? 0;
        const offset = attack.offset ?? 0;
        const hpLimit = attack.hpBelowPercent ?? null;

        return (
          <article className="attack-card" key={attack.id}>
            <header className="attack-head">
              <span className="field-label">{index + 1}</span>
              <input
                className="ctl input"
                value={attack.name}
                maxLength={24}
                placeholder="공격 이름"
                onChange={(event) => patch(index, { name: event.target.value })}
              />
              <div className="btn-row">
                <button
                  type="button"
                  className="ctl small"
                  disabled={index === 0}
                  title="위로 — 조건이 겹칠 때 위에 있는 공격이 이깁니다"
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="ctl small"
                  disabled={index === attacks.length - 1}
                  title="아래로"
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="ctl small"
                  title="이 공격을 지웁니다"
                  onClick={() => onChange(attacks.filter((_, i) => i !== index))}
                >
                  ✕
                </button>
              </div>
            </header>

            <label className="input-row">
              <span className="field-label">연출 문구</span>
              <input
                className="ctl input"
                value={attack.description}
                maxLength={160}
                placeholder="예: 꼬리를 휘둘러 전열을 쓸어낸다"
                onChange={(event) => patch(index, { description: event.target.value })}
              />
            </label>

            <div className="attack-row">
              <NumberInput
                label="피해 계수"
                value={attack.powerRatio}
                step={0.1}
                max={5}
                onChange={(value) => patch(index, { powerRatio: Math.max(0, value) })}
                hint={`공격력 ${enemyAttack} × ${attack.powerRatio} ≈ ${Math.round(
                  enemyAttack * attack.powerRatio,
                )}`}
              />
              <label className="num-field">
                <span className="field-label">범위</span>
                <select
                  className="ctl input"
                  value={attack.aoe ? 'AOE' : 'SINGLE'}
                  onChange={(event) => patch(index, { aoe: event.target.value === 'AOE' })}
                >
                  <option value="SINGLE">단일 — 한 페어</option>
                  <option value="AOE">광역 — 모든 페어</option>
                </select>
              </label>
              <NumberInput
                label="예고 라운드"
                value={attack.telegraphRounds}
                max={3}
                onChange={(value) => patch(index, { telegraphRounds: Math.max(0, value) })}
                hint={attack.telegraphRounds > 0 ? '예고 후 발동' : '즉시 발동'}
              />
              <label className="num-field">
                <span className="field-label">이름 공개</span>
                <select
                  className="ctl input"
                  value={attack.revealed ? 'YES' : 'NO'}
                  onChange={(event) => patch(index, { revealed: event.target.value === 'YES' })}
                >
                  <option value="YES">공개 — 참가자가 다음 공격을 안다</option>
                  <option value="NO">비공개 — UNKNOWN 으로 보인다</option>
                </select>
              </label>
            </div>

            {attack.telegraphRounds > 0 && (
              <label className="input-row">
                <span className="field-label">예고 문구</span>
                <input
                  className="ctl input"
                  value={attack.telegraphMessage}
                  maxLength={160}
                  placeholder="예: 탑이 울린다 — 다음 라운드 광역 공격"
                  onChange={(event) => patch(index, { telegraphMessage: event.target.value })}
                />
              </label>
            )}

            {/* ── 발동 조건 ── */}
            <div className="attack-row">
              <label className="num-field">
                <span className="field-label">라운드 주기</span>
                <select
                  className="ctl input"
                  value={every}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    patch(index, { every: next, offset: next >= 2 ? offset % next : 0 });
                  }}
                >
                  <option value={0}>조건 없음 — 순서대로</option>
                  {[2, 3, 4, 5, 6].map((value) => (
                    <option key={value} value={value}>
                      {value} 라운드마다
                    </option>
                  ))}
                </select>
                <small className="dim">{everyHint(every, offset)}</small>
              </label>
              {every >= 2 && (
                <label className="num-field">
                  <span className="field-label">주기 안의 자리</span>
                  <select
                    className="ctl input"
                    value={offset % every}
                    onChange={(event) => patch(index, { offset: Number(event.target.value) })}
                  >
                    {Array.from({ length: every }, (_, i) => i).map((value) => (
                      <option key={value} value={value}>
                        {everyHint(every, value)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <NumberInput
                label="HP 조건 (%)"
                value={hpLimit ?? 0}
                max={100}
                onChange={(value) =>
                  patch(index, {
                    hpBelowPercent: value > 0 ? Math.min(100, value) : null,
                  })
                }
                hint={hpLimit === null ? '0 이면 조건 없음' : `적 HP ${hpLimit}% 이하에서만`}
              />
            </div>

            <div className="input-row">
              <span className="field-label">사용 페이즈 (선택하지 않으면 전체)</span>
              <div className="btn-row">
                {Array.from({ length: phases }, (_, i) => i + 1).map((phase) => (
                  <button
                    key={phase}
                    type="button"
                    className={`ctl small ${attack.phases.includes(phase) ? 'on' : ''}`}
                    onClick={() => togglePhase(index, phase)}
                  >
                    PHASE {phase}
                  </button>
                ))}
                {attack.phases.length === 0 && <span className="hint">모든 페이즈에서 사용</span>}
              </div>
            </div>

            <div className="input-row">
              <span className="field-label">맞은 쪽에 부여</span>
              <div className="status-picker">
                {STATUS_DEFINITIONS.filter((def) => def.appliesTo !== 'ENEMY').map((def) => (
                  <button
                    key={def.id}
                    type="button"
                    className={`chip-btn ${attack.applyStatusIds.includes(def.id) ? 'on' : ''}`}
                    title={`${def.description} · ${def.duration}R`}
                    onClick={() => toggleStatus(index, 'applyStatusIds', def.id)}
                  >
                    {def.label}
                    <small>{def.labelKo}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="input-row">
              <span className="field-label">자신에게 부여</span>
              <div className="status-picker">
                {STATUS_DEFINITIONS.filter((def) => def.appliesTo === 'ENEMY').map((def) => (
                  <button
                    key={def.id}
                    type="button"
                    className={`chip-btn ${attack.selfStatusIds.includes(def.id) ? 'on' : ''}`}
                    title={`${def.description} · ${def.duration}R`}
                    onClick={() => toggleStatus(index, 'selfStatusIds', def.id)}
                  >
                    {def.label}
                    <small>{def.labelKo}</small>
                  </button>
                ))}
              </div>
            </div>
          </article>
        );
      })}

      <button
        type="button"
        className="ctl wide"
        onClick={() => onChange([...attacks, blankAttack(attacks.length)])}
      >
        + 공격 추가
        <small>{attacks.length}개</small>
      </button>
    </div>
  );
}
