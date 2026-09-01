/**
 * 참가자 시트 열람 탭.
 *
 * 판정하면서 읽는 화면이라 밀도는 높게 두되, 참가자가 보는 프로필 카드와
 * **같은 서식**으로 세운다 — 같은 사람의 서류가 화면마다 다르게 생기면
 * 어느 쪽이 그 사람인지 눈이 매번 다시 익혀야 한다.
 *
 * 전문(DETAIL)과 카드(PROFILE)를 오갈 수 있고, 소지금·보급품 창구도 여기서 연다.
 */

import { useState } from 'react';

import { PROFILE_FIELDS } from '../../config/characters';
import Collapsible from '../Collapsible';
import SheetEditor from '../SheetEditor';
import { PublicSheetCard, SheetDetail, type Supply } from '../SheetView';
import { toPublicProfile, type PublicProfile } from '../../store';
import { useOps } from './OpsContext';
import { PublicSheetLink, SupplyAdmin, type SheetLayout } from './shared';
import { useSheetAdmin } from './useSheetAdmin';
import type { SheetRecord } from '../../store';
import type { CharacterSheet, PairBond } from '../../types';

type SheetFilter = 'ALL' | 'HUNTER' | 'CONSTELLATION' | 'UNPAIRED';

export default function SheetTab({
  sheets,
  profiles,
  activeBonds,
  sheetOf,
}: {
  sheets: SheetRecord[];
  /** 카드 보기에서 참가자에게 보이는 그대로를 띄우는 데 쓴다 */
  profiles: PublicProfile[];
  activeBonds: PairBond[];
  sheetOf: (accountId: string | null) => CharacterSheet | null;
}) {
  const ops = useOps();
  const { busy, refresh } = ops;
  const [sheetFilter, setSheetFilter] = useState<SheetFilter>('ALL');
  const [sheetLayout, setSheetLayout] = useState<SheetLayout>('DETAIL');
  const [sheetQuery, setSheetQuery] = useState('');
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null);
  const { saveSheet, deleteSheet, giveSheetPoints, giveSheetItem } = useSheetAdmin(ops, () =>
    setEditingSheetId(null),
  );

  /** 시트 소유자가 속한 활성 페어 */
  const bondOf = (accountId: string) =>
    activeBonds.find(
      (bond) =>
        bond.hunterAccountId === accountId || bond.constellationAccountId === accountId,
    ) ?? null;

  /** 개인 지갑과 가방 — 시트에 붙어 있다 */
  const supplyOf = (accountId: string): Supply | null => {
    const sheet = sheetOf(accountId);
    if (!sheet) return null;
    return { points: sheet.points ?? 0, inventory: sheet.inventory ?? [] };
  };

  /** 컨셉 세 칸과 계약 상대를 한 덩어리로 묶어 검색에 태운다 */
  const profileText = (sheet: CharacterSheet) =>
    [sheet.partnerName, ...PROFILE_FIELDS.map((field) => sheet[field.key] ?? '')]
      .join(' ')
      .toLowerCase();

  const query = sheetQuery.trim().toLowerCase();
  const filteredSheets = sheets
    .filter((row) => {
      switch (sheetFilter) {
        case 'HUNTER':
          return row.sheet.side === 'HUNTER';
        case 'CONSTELLATION':
          return row.sheet.side === 'CONSTELLATION';
        case 'UNPAIRED':
          return !bondOf(row.accountId);
        default:
          return true;
      }
    })
    .filter(
      (row) =>
        !query ||
        row.sheet.name.toLowerCase().includes(query) ||
        row.accountId.toLowerCase().includes(query) ||
        row.sheet.classId.toLowerCase().includes(query) ||
        profileText(row.sheet).includes(query) ||
        (row.sheet.skills ?? []).some((skill) => skill.name.toLowerCase().includes(query)),
    );

  return (
    <section className="panel">
      <div className="process-head">
        <h2 className="panel-title">참가자 시트 · {filteredSheets.length}</h2>
        <div className="btn-row">
          {(
            [
              ['ALL', `전체 ${sheets.length}`],
              ['HUNTER', `헌터 ${sheets.filter((r) => r.sheet.side === 'HUNTER').length}`],
              [
                'CONSTELLATION',
                `성좌 ${sheets.filter((r) => r.sheet.side === 'CONSTELLATION').length}`,
              ],
              ['UNPAIRED', `미편성 ${sheets.filter((r) => !bondOf(r.accountId)).length}`],
            ] as Array<[SheetFilter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`ctl small ${sheetFilter === value ? 'on' : ''}`}
              onClick={() => setSheetFilter(value)}
            >
              {label}
            </button>
          ))}
          <span className="ctl-sep" />
          {/* 전체 인원 카드는 이 화면(운영진)에만 있다 — 참가자는 자기 것과 페어 상대만 본다 */}
          <button
            type="button"
            className={`ctl small ${sheetLayout === 'DETAIL' ? 'on' : ''}`}
            onClick={() => setSheetLayout('DETAIL')}
          >
            시트 전문
          </button>
          <button
            type="button"
            className={`ctl small ${sheetLayout === 'PROFILE' ? 'on' : ''}`}
            onClick={() => setSheetLayout('PROFILE')}
          >
            프로필 카드
          </button>
          <button type="button" className="ctl small" onClick={() => void refresh()}>
            새로 고침
          </button>
        </div>
      </div>

      <label className="input-row sheet-search">
        <span className="field-label">검색</span>
        <input
          className="ctl input"
          value={sheetQuery}
          placeholder="이름 · 활동명 · 스킬명 · 컨셉"
          onChange={(event) => setSheetQuery(event.target.value)}
        />
      </label>

      {sheets.length === 0 ? (
        <p className="dim">
          불러온 시트가 없습니다.
          {profiles.length > 0 && (
            <>
              {' '}
              등록된 참가자는 {profiles.length}명입니다 — 이 계정의 <b>profiles.role</b> 이
              OPERATOR 가 아니면 서버가 남의 시트를 내려주지 않습니다.
            </>
          )}
        </p>
      ) : filteredSheets.length === 0 ? (
        <p className="dim">조건에 맞는 시트가 없습니다.</p>
      ) : sheetLayout === 'PROFILE' ? (
        <div className="dossier-list">
          {filteredSheets.map((row) => {
            const bond = bondOf(row.accountId);
            const partner = bond
              ? row.sheet.side === 'HUNTER'
                ? bond.constellationName
                : bond.hunterName
              : null;

            return (
              <div className="dossier-slot" key={`${row.accountId}-${row.sheet.id}`}>
                <PublicSheetCard
                  profile={toPublicProfile(row.accountId, row.sheet)}
                  partnerName={partner}
                  supply={supplyOf(row.accountId)}
                  badge={
                    bond ? (
                      <span className="tag ok">{bond.label}</span>
                    ) : (
                      <span className="tag offline">미편성</span>
                    )
                  }
                />
                <PublicSheetLink accountId={row.accountId} />
                <Collapsible label={`보급 조정 · ${row.sheet.points ?? 0} P`}>
                  <SupplyAdmin
                    row={row}
                    busy={busy}
                    onPoints={(target, delta) => void giveSheetPoints(target, delta)}
                    onItem={(target, itemId, delta) =>
                      void giveSheetItem(target, itemId, delta)
                    }
                  />
                </Collapsible>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="sheet-list">
          {filteredSheets.map((row) => {
            const bond = bondOf(row.accountId);

            if (editingSheetId === row.sheet.id) {
              return (
                <SheetEditor
                  key={`${row.accountId}-${row.sheet.id}`}
                  sheet={row.sheet}
                  accountId={row.accountId}
                  busy={busy}
                  onCancel={() => setEditingSheetId(null)}
                  onSave={(next) => void saveSheet(row.accountId, next)}
                  onDelete={() => void deleteSheet(row.accountId, row.sheet, bond?.label)}
                />
              );
            }

            return (
              <div key={`${row.accountId}-${row.sheet.id}`}>
                <SheetDetail
                  sheet={row.sheet}
                  accountId={row.accountId}
                  supply={supplyOf(row.accountId)}
                  note={
                    <>
                      {bond ? (
                        <span className="tag ok">{bond.label}</span>
                      ) : (
                        <span className="tag offline">미편성</span>
                      )}
                      <button
                        type="button"
                        className="ctl small"
                        onClick={() => setEditingSheetId(row.sheet.id)}
                      >
                        수정
                      </button>
                    </>
                  }
                />
                <Collapsible
                  label={`보급 조정 — ${row.sheet.name} · ${row.sheet.points ?? 0} P`}
                >
                  <SupplyAdmin
                    row={row}
                    busy={busy}
                    onPoints={(target, delta) => void giveSheetPoints(target, delta)}
                    onItem={(target, itemId, delta) =>
                      void giveSheetItem(target, itemId, delta)
                    }
                  />
                </Collapsible>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
