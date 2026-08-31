/**
 * 참가자 시트 편집 — 운영진 전용.
 *
 * 원칙은 admin.ts 와 같다: **운영진이 지정한 값을 그대로 반영한다.**
 * 배분 규칙(POINT_BUY)은 안내만 하고 막지 않는다 — 보정이 필요한 경우가 있다.
 *
 * 전투가 이미 시작된 페어는 전투 상태 쪽 수치가 원본이므로,
 * 여기서 시트를 고쳐도 진행 중인 전투에는 반영되지 않는다 (화면에 그렇게 적어 둔다).
 */

import { useEffect, useState } from 'react';

import {
  POINT_BUY,
  PROFILE_FIELDS,
  classesFor,
  describeTraits,
  findClass,
  remainingPoints,
  statsFor,
} from '../config/characters';
import { CURRENT_PHASE } from '../config/rules';
import { SKILL_RULES, blankSkill, skillKindsFor } from '../config/skills';
import { STATUS_DEFINITIONS } from '../config/status';
import type { Affiliation, CharacterSheet, SkillDefinition } from '../types';
import PortraitField from './PortraitField';

export default function SheetEditor({
  sheet,
  accountId,
  busy,
  onSave,
  onCancel,
  onDelete,
}: {
  sheet: CharacterSheet;
  accountId: string;
  busy?: boolean;
  onSave: (next: CharacterSheet) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<CharacterSheet>(sheet);

  // 다른 시트를 열면 초안을 갈아 끼운다
  useEffect(() => setDraft(sheet), [sheet]);

  const stats = statsFor(draft.side);
  const remaining = remainingPoints(draft.side, draft.stats);
  const kinds = skillKindsFor(draft.side);
  const skills = draft.skills ?? [];

  const patchSkill = (index: number, next: Partial<SkillDefinition>) => {
    setDraft({
      ...draft,
      skills: skills.map((skill, i) => (i === index ? { ...skill, ...next } : skill)),
    });
  };

  const toggleSkillStatus = (index: number, defId: string) => {
    const current = skills[index].applyStatusIds;
    patchSkill(index, {
      applyStatusIds: current.includes(defId)
        ? current.filter((id) => id !== defId)
        : [...current, defId],
    });
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(sheet);

  return (
    <article className={`sheet-card editing ${draft.side === 'HUNTER' ? 'hunter' : 'constellation'}`}>
      <header className="sheet-card-head">
        <span className={`tag ${draft.side === 'HUNTER' ? 'blue' : 'gold'}`}>
          {draft.side === 'HUNTER' ? '헌터' : '성좌'}
        </span>
        <b>{draft.name || '(이름 없음)'}</b>
        <span className="field-label">@{accountId}</span>
        <span className="tag warn">편집 중</span>
      </header>

      <PortraitField
        value={draft.portrait}
        name={draft.name}
        onChange={(portrait) => setDraft({ ...draft, portrait })}
      />

      <div className="attack-row">
        <label className="num-field">
          <span className="field-label">
            {draft.side === 'HUNTER' ? '이름' : '성호'}
            <small className="dim"> 겹칠 수 없습니다</small>
          </span>
          <input
            className="ctl input"
            value={draft.name}
            maxLength={24}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <label className="num-field">
          <span className="field-label">{draft.side === 'HUNTER' ? '클래스' : '권역'}</span>
          <select
            className="ctl input"
            value={draft.classId}
            onChange={(event) => setDraft({ ...draft, classId: event.target.value })}
          >
            <option value="">선택 없음</option>
            {classesFor(draft.side).map((row) => (
              <option key={row.id} value={row.id}>
                {row.label} · {row.labelKo}
              </option>
            ))}
          </select>
          {describeTraits(findClass(draft.side, draft.classId)?.traits).map((line) => (
            <small key={line} className="gold">
              {line}
            </small>
          ))}
        </label>
        <label className="num-field">
          <span className="field-label">소속</span>
          <select
            className="ctl input"
            value={draft.affiliation}
            onChange={(event) =>
              setDraft({ ...draft, affiliation: event.target.value as Affiliation })
            }
          >
            <option value="GOVERNMENT">GOVERNMENT · 정부</option>
            <option value="PRIVATE_GUILD">PRIVATE GUILD · 민간 길드</option>
          </select>
        </label>
      </div>

      <div className="sheet-card-row block">
        <span className="field-label">
          스탯 · 남은 배분 {remaining} / {POINT_BUY.freePoints}
          {remaining !== 0 && <b className="warn-text"> (규칙과 다름 — 운영진 판단으로 저장됩니다)</b>}
        </span>
        <div className="attack-row">
          {stats.map((stat) => (
            <label className="num-field" key={stat.key}>
              <span className="field-label">
                {stat.label} · {stat.labelKo}
                {stat.activeFrom > CURRENT_PHASE && <small className="dim"> 미반영</small>}
              </span>
              <input
                className="ctl input tiny"
                type="number"
                min={0}
                value={draft.stats[stat.key] ?? POINT_BUY.baseValue}
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  if (Number.isNaN(parsed)) return;
                  setDraft({
                    ...draft,
                    stats: { ...draft.stats, [stat.key]: Math.max(0, parsed) },
                  });
                }}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="sheet-card-row block">
        <span className="field-label">스킬 {skills.length}</span>
        {skills.map((skill, index) => (
          <div className="attack-card" key={skill.id}>
            <header className="attack-head">
              <span className="field-label">{index + 1}</span>
              <input
                className="ctl input"
                value={skill.name}
                maxLength={SKILL_RULES.nameMaxLength}
                placeholder="스킬 이름"
                onChange={(event) => patchSkill(index, { name: event.target.value })}
              />
              <button
                type="button"
                className="ctl small"
                title="이 스킬을 지웁니다"
                onClick={() =>
                  setDraft({ ...draft, skills: skills.filter((_, i) => i !== index) })
                }
              >
                ✕
              </button>
            </header>

            <div className="attack-row">
              <label className="num-field">
                <span className="field-label">종류</span>
                <select
                  className="ctl input"
                  value={skill.kind}
                  onChange={(event) =>
                    patchSkill(index, { kind: event.target.value as SkillDefinition['kind'] })
                  }
                >
                  {kinds.map((row) => (
                    <option key={row.kind} value={row.kind}>
                      {row.label} · {row.labelKo}
                      {row.activeFrom > CURRENT_PHASE ? ' (미반영)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="num-field">
                <span className="field-label">AP</span>
                <input
                  className="ctl input tiny"
                  type="number"
                  min={0}
                  value={skill.apCost}
                  onChange={(event) =>
                    patchSkill(index, { apCost: Math.max(0, Number(event.target.value) || 0) })
                  }
                />
              </label>
              <label className="num-field">
                <span className="field-label">수치</span>
                <input
                  className="ctl input tiny"
                  type="number"
                  step={0.1}
                  min={0}
                  value={skill.power}
                  onChange={(event) =>
                    patchSkill(index, { power: Math.max(0, Number(event.target.value) || 0) })
                  }
                />
              </label>
              <label className="num-field">
                <span className="field-label">쿨타임</span>
                <input
                  className="ctl input tiny"
                  type="number"
                  min={0}
                  value={skill.cooldown}
                  onChange={(event) =>
                    patchSkill(index, { cooldown: Math.max(0, Number(event.target.value) || 0) })
                  }
                />
              </label>
              <label className="num-field">
                <span className="field-label">사용 횟수 (0 = 무제한)</span>
                <input
                  className="ctl input tiny"
                  type="number"
                  min={0}
                  value={skill.maxUses ?? 0}
                  onChange={(event) => {
                    const value = Math.max(0, Number(event.target.value) || 0);
                    patchSkill(index, { maxUses: value === 0 ? null : value });
                  }}
                />
              </label>
            </div>

            <label className="input-row">
              <span className="field-label">설명</span>
              <input
                className="ctl input"
                value={skill.description}
                maxLength={SKILL_RULES.descriptionMaxLength}
                onChange={(event) => patchSkill(index, { description: event.target.value })}
              />
            </label>
            <label className="input-row">
              <span className="field-label">특수 효과 (운영진 판정)</span>
              <input
                className="ctl input"
                value={skill.special}
                maxLength={SKILL_RULES.specialMaxLength}
                onChange={(event) => patchSkill(index, { special: event.target.value })}
              />
            </label>

            <div className="input-row">
              <span className="field-label">부여 상태이상</span>
              <div className="status-picker">
                {STATUS_DEFINITIONS.map((def) => (
                  <button
                    key={def.id}
                    type="button"
                    className={`chip-btn ${skill.applyStatusIds.includes(def.id) ? 'on' : ''}`}
                    title={`${def.description} · ${def.duration}R`}
                    onClick={() => toggleSkillStatus(index, def.id)}
                  >
                    {def.label}
                    <small>{def.labelKo}</small>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}

        <button
          type="button"
          className="ctl"
          onClick={() =>
            setDraft({ ...draft, skills: [...skills, blankSkill(draft.side, skills.length)] })
          }
        >
          + 스킬 추가
        </button>
      </div>

      <label className="input-row">
        <span className="field-label">페어명</span>
        <input
          className="ctl input"
          value={draft.pairName}
          placeholder="공란 가능"
          onChange={(event) => setDraft({ ...draft, pairName: event.target.value })}
        />
      </label>

      <label className="input-row">
        <span className="field-label">계약 상대</span>
        <input
          className="ctl input"
          value={draft.partnerName}
          placeholder="공란 가능"
          onChange={(event) => setDraft({ ...draft, partnerName: event.target.value })}
        />
      </label>

      {PROFILE_FIELDS.map((field) => (
        <label key={field.key} className="input-row">
          <span className="field-label">
            {field.labelKo}
            <small className="dim"> {(draft[field.key] ?? '').length}/{field.maxChars}</small>
          </span>
          <textarea
            className="ctl input textarea"
            rows={4}
            value={draft[field.key] ?? ''}
            onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
          />
        </label>
      ))}

      <div className="btn-row">
        <button
          type="button"
          className="ctl primary"
          disabled={busy || !dirty}
          onClick={() => onSave(draft)}
        >
          {busy ? '저장 중…' : dirty ? '저장' : '변경 없음'}
        </button>
        <button type="button" className="ctl" onClick={onCancel}>
          닫기
        </button>
        {onDelete && (
          <button type="button" className="ctl" disabled={busy} onClick={onDelete}>
            시트 삭제
          </button>
        )}
        <span className="hint">
          진행 중인 전투의 수치는 바뀌지 않습니다 — 전투 중 조정은 페어 모니터에서 하세요.
        </span>
      </div>
    </article>
  );
}
