/**
 * 전투 편성 탭 — 전투가 열려 있지 않을 때의 작전실.
 *
 * 참가할 페어와 배치할 적을 고르고 층·기믹을 정해 전투를 연다.
 * 같은 조합을 매번 다시 고르는 일이 잦아 프리셋을 브라우저에 남긴다 —
 * 서버 스키마를 건드리지 않으려는 것이라, 운영자 기기를 옮기면 따라오지 않는다.
 */

import { useEffect, useRef, useState } from 'react';

import { GIMMICK_DEFINITIONS } from '../../config/gimmicks';
import { findPatternSet } from '../../config/patterns';
import { DEFAULT_OPERATION } from '../../config/scenario';
import { assembleBattle, enemyFromTemplate, type BondEntry } from '../../engine/battle';
import Collapsible from '../Collapsible';
import { useOps } from './OpsContext';
import {
  NumberField,
  confirmed,
  loadPresets,
  newId,
  shortTime,
  writePresets,
  type OperationPreset,
} from './shared';
import type { SheetRecord } from '../../store';
import type {
  BattleState,
  EnemyState,
  BattleSummary,
  CharacterSheet,
  EnemyTemplate,
  PairBond,
} from '../../types';

export default function OperationSetupTab({
  bonds,
  activeBonds,
  templates,
  battles,
  sheets,
  sheetOf,
  openBattle,
}: {
  /** 해제된 편성까지 포함한 전체 — 전투를 세울 때 id 로 되짚는다 */
  bonds: PairBond[];
  activeBonds: PairBond[];
  templates: EnemyTemplate[];
  battles: BattleSummary[];
  sheets: SheetRecord[];
  sheetOf: (accountId: string | null) => CharacterSheet | null;
  openBattle: (next: BattleState) => void;
}) {
  const { storage, auth, busy, setBusy, guard, refresh, setMessage, setError } = useOps();
  const fileInput = useRef<HTMLInputElement>(null);
  const [selectedBonds, setSelectedBonds] = useState<string[]>([]);
  const [selectedEnemies, setSelectedEnemies] = useState<string[]>([]);
  const [gimmickId, setGimmickId] = useState<string>('gimmick.seal');
  const [floor, setFloor] = useState<number>(DEFAULT_OPERATION.floor);
  const [presets, setPresets] = useState<OperationPreset[]>([]);

  useEffect(() => setPresets(loadPresets()), []);

  const startOperation = async () => {
    if (selectedBonds.length === 0) {
      setMessage('참가할 페어를 선택하세요.');
      return;
    }
    if (selectedEnemies.length === 0) {
      setMessage('배치할 적을 선택하세요.');
      return;
    }

    // 이미 불러온 시트 목록을 먼저 쓰고, 없을 때만 서버에 다시 묻는다.
    const loadSheet = async (accountId: string | null): Promise<CharacterSheet | null> => {
      if (!accountId) return null;
      return sheetOf(accountId) ?? (await auth.getAccount(accountId))?.sheet ?? null;
    };

    const entries: BondEntry[] = [];
    for (const bondId of selectedBonds) {
      const bond = bonds.find((row) => row.id === bondId);
      if (!bond) continue;

      const hunterSheet = await loadSheet(bond.hunterAccountId);
      const constellationSheet = await loadSheet(bond.constellationAccountId);

      if (!hunterSheet || !constellationSheet) {
        const missing = [
          hunterSheet ? null : `헌터 ${bond.hunterAccountId ?? '미지정'}`,
          constellationSheet ? null : `성좌 ${bond.constellationAccountId ?? '미지정'}`,
        ]
          .filter(Boolean)
          .join(' · ');
        setMessage(`${bond.label} 의 시트를 불러올 수 없습니다 — ${missing}`);
        return;
      }

      entries.push({ bond, hunterSheet, constellationSheet });
    }

    const enemies: EnemyState[] = selectedEnemies
      .map((id, index) => {
        const template = templates.find((row) => row.id === id);
        return template ? enemyFromTemplate(template, index) : null;
      })
      .filter((row): row is EnemyState => row !== null);

    const next = assembleBattle({
      id: newId(),
      mode: entries.length > 1 ? 'RAID' : 'DUEL',
      operation: { ...DEFAULT_OPERATION, floor },
      entries,
      enemies,
      gimmickId: gimmickId || null,
    });

    setBusy(true);
    setError(null);
    try {
      // 저장이 실패하면 참가자 단말에 전투가 열리지 않는다 — 반드시 알린다.
      await storage.saveBattle(next);
      openBattle(next);
      setMessage(
        `FLOOR ${floor} 전투를 시작했습니다. 참가자 단말이 자동으로 전투 화면으로 넘어갑니다.`,
      );
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `전투를 시작하지 못했습니다: ${caught.message}`
          : '전투를 시작하지 못했습니다.',
      );
    } finally {
      setBusy(false);
    }
  };

  /* ── 데이터 입출력 ───────────────────────────────── */

  const savePresets = (rows: OperationPreset[]) => {
    setPresets(rows);
    if (!writePresets(rows)) setError('프리셋을 저장할 수 없습니다 (브라우저 저장소 제한).');
  };

  const capturePreset = () => {
    const name = window.prompt(
      '프리셋 이름',
      `FLOOR ${floor} · ${selectedBonds.length}페어`,
    );
    if (!name) return;
    savePresets([
      ...presets.filter((row) => row.name !== name),
      {
        id: newId(),
        name,
        bondIds: [...selectedBonds],
        enemyIds: [...selectedEnemies],
        gimmickId,
        floor,
      },
    ]);
    setMessage(`프리셋 「${name}」 을 저장했습니다.`);
  };

  /** 지금 명부에 남아 있는 것만 되살린다 — 지워진 페어 · 적은 조용히 빠진다 */
  const usePreset = (preset: OperationPreset) => {
    const bondIds = preset.bondIds.filter((id) => activeBonds.some((row) => row.id === id));
    const enemyIds = preset.enemyIds.filter((id) => templates.some((row) => row.id === id));
    setSelectedBonds(bondIds);
    setSelectedEnemies(enemyIds);
    setGimmickId(preset.gimmickId);
    setFloor(preset.floor);

    const dropped =
      preset.bondIds.length - bondIds.length + (preset.enemyIds.length - enemyIds.length);
    setMessage(
      dropped > 0
        ? `프리셋 「${preset.name}」 적용 — 사라진 항목 ${dropped}건은 빠졌습니다.`
        : `프리셋 「${preset.name}」 을 불러왔습니다.`,
    );
  };

  /**
   * 미제출자를 채널로 부른다.
   * 누가 안 냈는지 일일이 옮겨 적는 대신 한 번에 올린다.
   */

  /**
   * 편성한 적과 층 기믹이 서로 맞는지 본다.
   * 포식처럼 기믹 해제를 전제로 한 패턴은 장치 없이 세우면 받아 낼 방법이 없다.
   */
  const gimmickWarning: string | null = (() => {
    const picked = selectedEnemies
      .map((id) => templates.find((row) => row.id === id))
      .filter((row): row is EnemyTemplate => Boolean(row));

    const needs = picked.filter(
      (row) => findPatternSet(row.patternSetId ?? null)?.requiresGimmick,
    );
    if (!gimmickId && needs.length > 0) {
      return `${needs.map((row) => row.name).join(' · ')} 의 패턴은 층 기믹 해제를 전제로 합니다. 기믹을 고르거나, 기믹 없이도 성립하는 패턴 세트로 바꾸세요.`;
    }
    if (gimmickId && picked.length > 0 && needs.length === 0) {
      return '고른 적 중 기믹을 전제로 한 패턴이 없습니다. 기믹은 별도의 목표로만 굴러갑니다.';
    }
    return null;
  })();

  const exportJson = async () => {
    const json = await storage.exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tower-raid-backup.json';
    link.click();
    URL.revokeObjectURL(url);
    setMessage('전투 데이터를 내보냈습니다.');
  };

  const importJson = async (file: File) => {
    try {
      await storage.importAll(await file.text());
      await refresh();
      setMessage('데이터를 불러왔습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '불러오기에 실패했습니다.');
    }
  };

  /* ── 공략 기록 ───────────────────────────────────── */

  return (
      <section className="panel">
        <div className="process-head">
          <h2 className="panel-title">전투 편성</h2>
          <span className="hint">등록된 페어 중 참가자를 고르고 적을 배치합니다.</span>
        </div>

        <h3 className="sub-title">참가 페어 ({selectedBonds.length})</h3>
        {activeBonds.length === 0 ? (
          <p className="dim">
            편성된 페어가 없습니다. <b>편성</b> 탭에서 먼저 짝을 맺으세요.
          </p>
        ) : (
          <div className="pick-grid">
            {activeBonds.map((bond) => (
              <button
                key={bond.id}
                type="button"
                className={`pick-card ${selectedBonds.includes(bond.id) ? 'on' : ''}`}
                onClick={() =>
                  setSelectedBonds((current) =>
                    current.includes(bond.id)
                      ? current.filter((id) => id !== bond.id)
                      : [...current, bond.id],
                  )
                }
              >
                <b>{bond.label}</b>
                <span className="dim">
                  {bond.hunterName} × {bond.constellationName}
                </span>
              </button>
            ))}
          </div>
        )}

        <h3 className="sub-title">배치 적 ({selectedEnemies.length})</h3>
        {templates.length === 0 ? (
          <p className="dim">
            등록된 적이 없습니다. <b>적 세팅</b> 탭에서 먼저 만드세요.
          </p>
        ) : (
          <div className="pick-grid">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                className={`pick-card ${selectedEnemies.includes(template.id) ? 'on' : ''} ${
                  template.boss ? 'boss' : ''
                }`}
                onClick={() =>
                  setSelectedEnemies((current) =>
                    current.includes(template.id)
                      ? current.filter((id) => id !== template.id)
                      : [...current, template.id],
                  )
                }
              >
                <b>{template.name}</b>
                <span className="dim">
                  HP {template.maxHp} · ATK {template.attack} · DEF {template.defense}
                </span>
              </button>
            ))}
          </div>
        )}

        <h3 className="sub-title">층 설정</h3>
        <div className="admin-grid">
          <NumberField label="층" value={floor} min={1} onCommit={setFloor} />
          <label className="num-field">
            <span className="field-label">기믹</span>
            <select
              className="ctl input"
              value={gimmickId}
              onChange={(event) => setGimmickId(event.target.value)}
            >
              <option value="">없음 (장치 없는 전투)</option>
              {GIMMICK_DEFINITIONS.map((def) => (
                <option key={def.id} value={def.id}>
                  {def.labelKo} · {def.required}회 / {def.roundLimit ?? '∞'}R
                </option>
              ))}
            </select>
            <small className="hint">
              {gimmickId
                ? '헌터의 기믹 수행으로 파악 → 해결 순으로 풉니다.'
                : '기믹 수행 행동이 잠깁니다. 보스 패턴만으로 진행하는 전투가 됩니다.'}
            </small>
          </label>
        </div>

        {/* 기믹이 있어야 성립하는 보스를 장치 없이 세우면 그대로 학살이 된다 */}
        {gimmickWarning && <p className="notice warn">{gimmickWarning}</p>}

        {/* 같은 조합을 매번 다시 고르지 않게 한다. 이 브라우저에만 남는다. */}
        <h3 className="sub-title">프리셋</h3>
        <div className="preset-bar">
          <button
            type="button"
            className="ctl small"
            disabled={selectedBonds.length === 0 && selectedEnemies.length === 0}
            onClick={capturePreset}
          >
            지금 구성 저장
          </button>
          {presets.length === 0 ? (
            <span className="dim small-text">저장된 프리셋이 없습니다.</span>
          ) : (
            presets.map((preset) => (
              <span key={preset.id} className="preset-chip">
                <button type="button" className="ctl small" onClick={() => usePreset(preset)}>
                  {preset.name}
                </button>
                <button
                  type="button"
                  className="ctl small"
                  title="이 프리셋을 지웁니다"
                  onClick={() =>
                    savePresets(presets.filter((row) => row.id !== preset.id))
                  }
                >
                  ✕
                </button>
              </span>
            ))
          )}
        </div>

        <button
          type="button"
          className="confirm-btn"
          disabled={busy || selectedBonds.length === 0 || selectedEnemies.length === 0}
          onClick={() => void startOperation()}
        >
          {busy ? '전투를 만드는 중…' : '전투 시작'}
          <small>
            {selectedBonds.length}페어 · 적 {selectedEnemies.length}체 · FLOOR {floor}
          </small>
        </button>

        {battles.length > 0 && (
          <Collapsible label={`지난 전투 ${battles.length}`} defaultOpen={battles.length <= 3}>
            <table className="preview-table">
              <thead>
                <tr>
                  <th>작전</th>
                  <th>규모</th>
                  <th>라운드</th>
                  <th>상태</th>
                  <th>마지막 갱신</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {battles.map((row) => (
                  <tr key={row.id}>
                    <td>{row.operationName || '이름 없는 작전'}</td>
                    <td className="dim small-text">
                      {row.mode === 'RAID' ? '레이드' : '단독'}
                    </td>
                    <td className="num">R{row.round}</td>
                    <td>
                      <span
                        className={`tag ${
                          row.status === 'ENGAGED'
                            ? 'ok'
                            : row.status === 'CLEARED'
                              ? 'blue'
                              : row.status === 'FAILED'
                                ? 'critical'
                                : 'warn'
                        }`}
                      >
                        {row.status === 'ENGAGED'
                          ? '진행 중'
                          : row.status === 'CLEARED'
                            ? '클리어'
                            : row.status === 'FAILED'
                              ? '실패'
                              : '준비'}
                      </span>
                    </td>
                    <td className="dim small-text num">{shortTime(row.updatedAt)}</td>
                    <td>
                      <div className="btn-row">
                        <button
                          type="button"
                          className="ctl small"
                          onClick={async () => {
                            const loaded = await storage.loadBattle(row.id);
                            if (loaded) {
                              openBattle(loaded);
                            } else setMessage('불러올 수 없습니다 (스키마 버전 불일치).');
                          }}
                        >
                          열기
                        </button>
                        <button
                          type="button"
                          className="ctl small"
                          title="이 전투 기록을 지웁니다"
                          onClick={() => {
                            if (
                              !confirmed(
                                `${row.operationName || '이 전투'} 기록을 삭제합니다. 로그와 제출까지 함께 지워지고 되돌릴 수 없습니다.`,
                              )
                            ) {
                              return;
                            }
                            void guard(async () => {
                              await storage.deleteBattle(row.id);
                              await refresh();
                              setMessage('전투 기록을 삭제했습니다.');
                            });
                          }}
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Collapsible>
        )}

        <div className="btn-row" style={{ marginTop: 14 }}>
          <button type="button" className="ctl small" onClick={() => void exportJson()}>
            EXPORT JSON
          </button>
          <button type="button" className="ctl small" onClick={() => fileInput.current?.click()}>
            IMPORT JSON
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importJson(file);
              event.target.value = '';
            }}
          />
        </div>
      </section>
  );
}
