/**
 * 적 세팅 탭.
 *
 * 층에 올릴 적을 미리 만들어 둔다. 보스는 페이즈와 공격 패턴까지 여기서 정한다 —
 * 코드에 있는 프리셋은 고칠 수 없으므로, 한 번 펼쳐서 그 보스만의 패턴으로 만든 뒤 손본다.
 */

import { PATTERN_SETS, findPatternSet } from '../../config/patterns';
import { describePhaseBands, normalizeCutoffs, patternSetToPreset } from '../../engine/enemy';
import AttackEditor from '../AttackEditor';
import Collapsible from '../Collapsible';
import { useOps } from './OpsContext';
import { NumberField, TextField, confirmed, newId } from './shared';
import type { EnemyTemplate } from '../../types';

export default function EncounterTab({ templates }: { templates: EnemyTemplate[] }) {
  const { storage, busy, guard, refresh, setMessage } = useOps();

  const addTemplate = async (boss: boolean) => {
    const template: EnemyTemplate = {
      id: newId(),
      name: boss ? '새 보스' : '새 몬스터',
      grade: boss ? 'BOSS / A' : 'NORMAL / C',
      maxHp: boss ? 1000 : 180,
      attack: boss ? 14 : 9,
      defense: boss ? 6 : 3,
      maxPhase: boss ? 3 : 1,
      patternSetId: boss ? 'set.star_devourer' : 'set.husk',
      attacks: [],
      phaseCutoffs: [],
      boss,
    };
    await guard(async () => {
      await storage.saveEnemyTemplate(template);
      await refresh();
      setMessage(`${template.name} 추가됨 — 이름과 수치를 편집하세요.`);
    });
  };

  const patchTemplate = async (template: EnemyTemplate, patch: Partial<EnemyTemplate>) => {
    await guard(async () => {
      await storage.saveEnemyTemplate({ ...template, ...patch });
      await refresh();
    });
  };

  /**
   * 프리셋 패턴을 편집 가능한 공격 목록으로 펼친다.
   *
   * 프리셋은 코드에 있어 고칠 수 없다 — 한 번 펼쳐 두면 그 보스만의 패턴으로
   * 이름 · 계수 · 예고 · 주기까지 전부 운영진이 손볼 수 있다.
   */
  const importPreset = async (template: EnemyTemplate) => {
    const preset = patternSetToPreset(template.patternSetId ?? null);
    if (!preset) {
      setMessage('불러올 프리셋 패턴을 먼저 고르세요.');
      return;
    }
    const current = (template.attacks ?? []).length;
    if (
      current > 0 &&
      !confirmed(`${template.name} 에 만들어 둔 공격 ${current}개를 프리셋으로 덮어씁니다.`)
    ) {
      return;
    }

    await patchTemplate(template, {
      attacks: preset.attacks,
      phaseCutoffs: preset.phaseCutoffs,
      maxPhase: Math.max(template.maxPhase, preset.maxPhase),
    });
    setMessage(
      `${findPatternSet(template.patternSetId ?? null)?.labelKo} 패턴을 불러왔습니다 — 이제 자유롭게 고칠 수 있습니다.`,
    );
  };

  return (
    <section className="panel">
      <div className="process-head">
        <h2 className="panel-title">적 목록</h2>
        <div className="btn-row">
          <button
            type="button"
            className="ctl primary"
            disabled={busy}
            onClick={() => void addTemplate(true)}
          >
            + 보스 추가
          </button>
          <button
            type="button"
            className="ctl"
            disabled={busy}
            onClick={() => void addTemplate(false)}
          >
            + 일반 몬스터 추가
          </button>
        </div>
      </div>

      {templates.length === 0 ? (
        <p className="dim">등록된 적이 없습니다. 위 버튼으로 추가하세요.</p>
      ) : (
        <div className="enemy-list">
          {templates.map((template) => (
            <article className={`enemy-card ${template.boss ? 'boss' : ''}`} key={template.id}>
              <div className="enemy-card-head">
                <span className={`tag ${template.boss ? 'critical' : ''}`}>
                  {template.boss ? 'BOSS' : 'NORMAL'}
                </span>
                <b>{template.name}</b>
                <button
                  type="button"
                  className="ctl small"
                  title="이 적을 삭제합니다"
                  onClick={() => {
                    if (!confirmed(`${template.name} 을 삭제합니다. 되돌릴 수 없습니다.`)) return;
                    void guard(async () => {
                      await storage.deleteEnemyTemplate(template.id);
                      await refresh();
                    });
                  }}
                >
                  ✕
                </button>
              </div>
              <div className="admin-grid">
                <TextField
                  label="이름"
                  value={template.name}
                  onCommit={(value) => void patchTemplate(template, { name: value })}
                />
                <TextField
                  label="등급 표기"
                  value={template.grade}
                  onCommit={(value) => void patchTemplate(template, { grade: value })}
                  placeholder="BOSS / A"
                />
                <NumberField
                  label="최대 HP"
                  value={template.maxHp}
                  min={1}
                  step={10}
                  onCommit={(value) => void patchTemplate(template, { maxHp: value })}
                />
                <NumberField
                  label="공격력"
                  value={template.attack}
                  onCommit={(value) => void patchTemplate(template, { attack: value })}
                />
                <NumberField
                  label="방어력"
                  value={template.defense}
                  onCommit={(value) => void patchTemplate(template, { defense: value })}
                />
                <NumberField
                  label="페이즈 수"
                  value={template.maxPhase}
                  min={1}
                  max={5}
                  /* 직접 정한 경계가 있으면 새 페이즈 수에 맞춰 다시 나눈다 */
                  onCommit={(value) =>
                    void patchTemplate(template, {
                      maxPhase: value,
                      phaseCutoffs:
                        (template.phaseCutoffs ?? []).length > 0
                          ? normalizeCutoffs(template.phaseCutoffs, value)
                          : [],
                    })
                  }
                />
                <label className="num-field">
                  <span className="field-label">
                    프리셋 패턴 {(template.attacks ?? []).length > 0 && '(사용 안 함)'}
                  </span>
                  <select
                    className="ctl input"
                    value={template.patternSetId ?? ''}
                    disabled={(template.attacks ?? []).length > 0}
                    onChange={(event) =>
                      void patchTemplate(template, { patternSetId: event.target.value || null })
                    }
                  >
                    <option value="">없음 (단일 공격만)</option>
                    {PATTERN_SETS.map((set) => (
                      <option key={set.id} value={set.id}>
                        {set.labelKo}
                      </option>
                    ))}
                  </select>
                  <small className="hint">
                    {findPatternSet(template.patternSetId ?? null)?.note ??
                      '패턴 없이 매 라운드 단일 공격만 합니다.'}
                    {template.patternSetId && (template.attacks ?? []).length === 0 && (
                      <> 아래 <b>보스 패턴</b> 에서 불러오면 그대로 고칠 수 있습니다.</>
                    )}
                  </small>
                </label>
                <label className="num-field">
                  <span className="field-label">보스 여부</span>
                  <select
                    className="ctl input"
                    value={template.boss ? 'YES' : 'NO'}
                    onChange={(event) =>
                      void patchTemplate(template, { boss: event.target.value === 'YES' })
                    }
                  >
                    <option value="YES">보스</option>
                    <option value="NO">일반</option>
                  </select>
                </label>
              </div>

              <Collapsible
                label={`보스 패턴 — 공격 ${(template.attacks ?? []).length}개 · ${describePhaseBands(
                  template,
                )}`}
                defaultOpen={(template.attacks ?? []).length > 0}
              >
                <AttackEditor
                  attacks={template.attacks ?? []}
                  maxPhase={template.maxPhase}
                  enemyAttack={template.attack}
                  maxHp={template.maxHp}
                  phaseCutoffs={template.phaseCutoffs ?? []}
                  patternSetId={template.patternSetId}
                  onChange={(attacks) => void patchTemplate(template, { attacks })}
                  onPhaseCutoffs={(phaseCutoffs) =>
                    void patchTemplate(template, { phaseCutoffs })
                  }
                  onImportPreset={
                    template.patternSetId ? () => void importPreset(template) : undefined
                  }
                  presetLabel={findPatternSet(template.patternSetId ?? null)?.labelKo}
                />
              </Collapsible>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
