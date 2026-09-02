/**
 * Supabase 기반 전투 저장 구현.
 *
 * BattleState 를 관계형 테이블로 나눠 저장한다.
 *   battles        전투 · 적 · 기믹 · 경보
 *   battle_pairs   편성과 담당 계정 (RLS 가 여기서 권한을 판정한다)
 *   submissions    라운드별 제출 (참가자는 자기 쪽만 쓸 수 있다)
 *   battle_log     시스템 · 연출 로그
 *
 * 참가자는 saveBattle 을 호출하지 않는다 — `submitSide()` 만 쓴다.
 * 전투 상태 쓰기는 RLS 에서 운영진으로 제한된다.
 */

import { SCHEMA_VERSION } from '../config/rules';
import { requireSupabase } from './supabaseClient';
import type {
  ExportEnvelope,
  PublicPair,
  PublicRecord,
  StorageAdapter,
} from './StorageAdapter';
import type {
  ActorSide,
  BattleRecord,
  BattleState,
  BattleSummary,
  ChatMessage,
  EnemyTemplate,
  PairBond,
  RouletteSpin,
  RouletteWheel,
  ShopItemRecord,
  PairState,
  RoundSubmission,
} from '../types';
import type { AuditDraft, AuditEntry, AuditPort } from './ports/AuditPort';
import type { RouletteCatalog } from './ports/RoulettePort';
import type { ShopCatalog } from './ports/ShopPort';

interface PairRow {
  id: string;
  battle_id: string;
  ordinal: number;
  label: string;
  affiliation: PairState['affiliation'];
  hunter_account: string | null;
  constellation_account: string | null;
  hunter: PairState['hunter'];
  constellation: PairState['constellation'];
  contract: PairState['contract'];
  /** @deprecated 소지금과 가방을 사람마다 나누기 전의 값. 옛 전투를 읽을 때만 본다 */
  points: number | null;
  /** @deprecated 옛 공용 가방 */
  inventory: PairState['hunter']['inventory'] | null;
  pattern_revealed: boolean;
}

interface SubmissionRow {
  pair_id: string;
  round: number;
  hunter_action_id: string | null;
  constellation_action_id: string | null;
  target_enemy_id: string | null;
  support_target_pair_id: string | null;
  gimmick_note: string | null;
  gimmick_stage: string | null;
  gimmick_check: unknown;
  hunter_item_id: string | null;
  constellation_item_id: string | null;
  hunter_submitted: boolean;
  constellation_submitted: boolean;
}

function emptySubmissionRow(): RoundSubmission {
  return {
    hunterActionId: null,
    constellationActionId: null,
    targetEnemyId: null,
    supportTargetPairId: null,
    gimmickNote: null,
    gimmickStage: null,
    gimmickCheck: null,
    hunterItemId: null,
    constellationItemId: null,
    hunterSubmitted: false,
    constellationSubmitted: false,
  };
}

function toSubmission(row: SubmissionRow | undefined): RoundSubmission {
  if (!row) return emptySubmissionRow();
  return {
    hunterActionId: row.hunter_action_id,
    constellationActionId: row.constellation_action_id,
    targetEnemyId: row.target_enemy_id,
    supportTargetPairId: row.support_target_pair_id,
    gimmickNote: row.gimmick_note ?? null,
    gimmickStage: (row.gimmick_stage as RoundSubmission['gimmickStage']) ?? null,
    gimmickCheck: (row.gimmick_check as RoundSubmission['gimmickCheck']) ?? null,
    hunterItemId: row.hunter_item_id ?? null,
    constellationItemId: row.constellation_item_id ?? null,
    hunterSubmitted: row.hunter_submitted,
    constellationSubmitted: row.constellation_submitted,
  };
}

/** 활동명과 계정 uuid 를 구분한다 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Realtime 이 끊겨도 진행이 멈추지 않게 하는 그물.
 *
 * 예전에는 화면마다 setInterval 을 따로 박아 3초 · 10초 · 15초로 갈려 있었다.
 * 무엇을 보든 같은 주기여야 한다 — 실시간이 주된 길이고 이쪽은 보험이다.
 */
const REALTIME_SAFETY_NET_MS = 15000;

export class SupabaseStorageAdapter
  implements StorageAdapter, ShopCatalog, RouletteCatalog, AuditPort
{
  /**
   * 계정 식별자 변환표.
   *
   * 화면과 편성(pair_bonds)은 계정을 **활동명**으로 다루는데,
   * battle_pairs 는 RLS 가 `auth.uid()` 와 비교해야 하므로 **uuid** 를 저장해야 한다.
   * 이 어댑터 경계에서만 서로 바꾼다 — 섞이면 참가자가 자기 전투를 못 찾는다.
   */
  private handleToId = new Map<string, string>();
  private idToHandle = new Map<string, string>();

  private async syncProfileMap(): Promise<void> {
    const { data } = await requireSupabase().from('profiles').select('id, handle');
    this.handleToId.clear();
    this.idToHandle.clear();
    for (const row of data ?? []) {
      this.handleToId.set(row.handle as string, row.id as string);
      this.idToHandle.set(row.id as string, row.handle as string);
    }
  }

  /** 활동명 → uuid. 이미 uuid 면 그대로 둔다. */
  private accountUuid(accountId: string | null): string | null {
    if (!accountId) return null;
    if (UUID_PATTERN.test(accountId)) return accountId;
    return this.handleToId.get(accountId) ?? null;
  }

  /** uuid → 활동명. 매핑이 없으면 원본을 그대로 둔다. */
  private accountHandle(id: string | null): string | null {
    if (!id) return null;
    return this.idToHandle.get(id) ?? id;
  }

  async loadBattle(id: string): Promise<BattleState | null> {
    const supabase = requireSupabase();
    await this.syncProfileMap();

    const { data: battle } = await supabase.from('battles').select('*').eq('id', id).maybeSingle();
    if (!battle) return null;

    const [{ data: pairRows }, { data: logRows }] = await Promise.all([
      supabase.from('battle_pairs').select('*').eq('battle_id', id).order('ordinal'),
      supabase.from('battle_log').select('*').eq('battle_id', id).order('created_at'),
    ]);

    const pairIds = (pairRows ?? []).map((row) => (row as PairRow).id);
    const { data: submissionRows } = pairIds.length
      ? await supabase
          .from('submissions')
          .select('*')
          .in('pair_id', pairIds)
          .eq('round', battle.round as number)
      : { data: [] as SubmissionRow[] };

    const submissionByPair = new Map<string, SubmissionRow>();
    for (const row of (submissionRows ?? []) as SubmissionRow[]) {
      submissionByPair.set(row.pair_id, row);
    }

    const pairs: PairState[] = (pairRows ?? []).map((raw) => {
      const row = raw as PairRow;

      // 소지금과 가방은 이제 사람 쪽(hunter · constellation)에 들어 있다.
      // 그 전에 저장된 전투는 페어 칸에만 값이 있으므로, 잃지 않도록 헌터에게 얹어 둔다 —
      // 운영진이 전투 화면에서 두 사람에게 나눠 줄 수 있다.
      const legacy = row.hunter.points === undefined;
      const hunter = legacy
        ? { ...row.hunter, points: row.points ?? 0, inventory: row.inventory ?? [] }
        : row.hunter;
      const constellation = legacy
        ? { ...row.constellation, points: 0, inventory: [] }
        : row.constellation;

      return {
        id: row.id,
        label: row.label,
        affiliation: row.affiliation,
        hunterAccountId: this.accountHandle(row.hunter_account),
        constellationAccountId: this.accountHandle(row.constellation_account),
        hunter,
        constellation,
        contract: row.contract,
        submission: toSubmission(submissionByPair.get(row.id)),
        patternRevealed: row.pattern_revealed,
      };
    });

    return {
      schemaVersion: battle.schema_version as number,
      id: battle.id as string,
      mode: battle.mode as BattleState['mode'],
      operation: battle.operation as BattleState['operation'],
      round: battle.round as number,
      status: battle.status as BattleState['status'],
      pairs,
      enemies: (battle.enemies ?? []) as BattleState['enemies'],
      gimmick: (battle.gimmick ?? null) as BattleState['gimmick'],
      viewerPairId: pairs[0]?.id ?? '',
      log: (logRows ?? []).map((raw) => {
        const row = raw as Record<string, unknown>;
        return {
          id: row.id as string,
          at: row.at as string,
          channel: row.channel as 'SYSTEM' | 'ROLEPLAY',
          round: row.round as number,
          pairId: (row.pair_id as string) ?? null,
          text: row.text as string,
          detail: (row.detail as string) ?? undefined,
          edited: Boolean(row.edited),
        };
      }),
      alerts: (battle.alerts ?? []) as BattleState['alerts'],
      rewards: (battle.rewards ?? []) as BattleState['rewards'],
    };
  }

  /** 운영진 전용 — RLS 가 참가자의 호출을 거부한다. */
  async saveBattle(state: BattleState): Promise<void> {
    const supabase = requireSupabase();
    await this.syncProfileMap();

    const { error: battleError } = await supabase.from('battles').upsert({
      id: state.id,
      schema_version: state.schemaVersion,
      mode: state.mode,
      operation: state.operation,
      round: state.round,
      status: state.status,
      enemies: state.enemies,
      gimmick: state.gimmick,
      alerts: state.alerts,
      rewards: state.rewards,
    });
    if (battleError) throw new Error(`전투 저장 실패: ${battleError.message}`);

    for (const [index, pair] of state.pairs.entries()) {
      const hunterAccount = this.accountUuid(pair.hunterAccountId);
      const constellationAccount = this.accountUuid(pair.constellationAccountId);

      // 활동명이 계정으로 이어지지 않으면 참가자가 자기 전투를 찾지 못한다 — 조용히 넘기지 않는다.
      for (const [label, given, resolved] of [
        ['헌터', pair.hunterAccountId, hunterAccount],
        ['성좌', pair.constellationAccountId, constellationAccount],
      ] as Array<[string, string | null, string | null]>) {
        if (given && !resolved) {
          throw new Error(
            `${pair.label} 의 ${label} 계정(${given})을 찾을 수 없습니다. 활동명이 바뀌었는지 확인하세요.`,
          );
        }
      }

      const { error } = await supabase.from('battle_pairs').upsert({
        id: pair.id,
        battle_id: state.id,
        ordinal: index,
        label: pair.label,
        affiliation: pair.affiliation,
        hunter_account: hunterAccount,
        constellation_account: constellationAccount,
        hunter: pair.hunter,
        constellation: pair.constellation,
        contract: pair.contract,
        // points · inventory 칸은 더 이상 쓰지 않는다 — 개인 소지금과 가방은
        // hunter · constellation 안에 들어 있다. 옛 값은 건드리지 않고 그대로 둔다.
        pattern_revealed: pair.patternRevealed,
      });
      if (error) throw new Error(`페어 저장 실패: ${error.message}`);
    }

    // 로그는 append 전용 — 이미 저장된 항목은 건드리지 않는다
    const { data: existing } = await supabase
      .from('battle_log')
      .select('id')
      .eq('battle_id', state.id);
    const known = new Set((existing ?? []).map((row) => row.id as string));

    const fresh = state.log.filter((entry) => !known.has(entry.id));
    if (fresh.length > 0) {
      await supabase.from('battle_log').insert(
        fresh.map((entry) => ({
          battle_id: state.id,
          round: entry.round,
          channel: entry.channel,
          at: entry.at,
          pair_id: entry.pairId,
          text: entry.text,
          detail: entry.detail ?? null,
          edited: Boolean(entry.edited),
        })),
      );
    }
  }

  /**
   * 참가자용 제출 경로.
   * 자기 쪽 칼럼만 보내고, 상대 쪽 값은 서버 트리거가 지킨다.
   */
  async submitSide(
    pairId: string,
    round: number,
    side: ActorSide,
    patch: {
      actionId?: string | null;
      targetEnemyId?: string | null;
      supportTargetPairId?: string | null;
      gimmickNote?: string | null;
      gimmickStage?: string | null;
      gimmickCheck?: unknown;
      itemId?: string | null;
      submitted?: boolean;
    },
  ): Promise<void> {
    const supabase = requireSupabase();

    // 라운드 행이 없으면 만든다
    await supabase.from('submissions').upsert(
      { pair_id: pairId, round },
      { onConflict: 'pair_id,round', ignoreDuplicates: true },
    );

    const update: Record<string, unknown> = {};
    if (side === 'HUNTER') {
      if (patch.actionId !== undefined) update.hunter_action_id = patch.actionId;
      if (patch.submitted !== undefined) update.hunter_submitted = patch.submitted;
      if (patch.targetEnemyId !== undefined) update.target_enemy_id = patch.targetEnemyId;
      if (patch.supportTargetPairId !== undefined) {
        update.support_target_pair_id = patch.supportTargetPairId;
      }
      if (patch.gimmickNote !== undefined) update.gimmick_note = patch.gimmickNote;
      if (patch.gimmickStage !== undefined) update.gimmick_stage = patch.gimmickStage;
      if (patch.gimmickCheck !== undefined) update.gimmick_check = patch.gimmickCheck;
      if (patch.itemId !== undefined) update.hunter_item_id = patch.itemId;
    } else {
      if (patch.actionId !== undefined) update.constellation_action_id = patch.actionId;
      if (patch.submitted !== undefined) update.constellation_submitted = patch.submitted;
      if (patch.itemId !== undefined) update.constellation_item_id = patch.itemId;
    }

    if (Object.keys(update).length === 0) return;

    const { error } = await supabase
      .from('submissions')
      .update(update)
      .eq('pair_id', pairId)
      .eq('round', round);

    if (error) throw new Error(`제출 실패: ${error.message}`);
  }

  /* ── 영구 편성 ── */

  async listBonds(): Promise<PairBond[]> {
    const { data } = await requireSupabase()
      .from('pair_bonds')
      .select('*')
      .order('created_at');

    return (data ?? []).map((row) => ({
      id: row.id as string,
      label: row.label as string,
      hunterAccountId: (row.hunter_handle as string) ?? null,
      constellationAccountId: (row.constellation_handle as string) ?? null,
      hunterName: (row.hunter_name as string) ?? '',
      constellationName: (row.constellation_name as string) ?? '',
      affiliation: row.affiliation as PairBond['affiliation'],
      active: Boolean(row.active),
      createdAt: row.created_at as string,
      points: (row.points as number) ?? 0,
      inventory: (row.inventory as PairBond['inventory']) ?? [],
    }));
  }

  /**
   * 공개 편성 — 뷰(`public_pairs`)를 읽는다.
   * pair_bonds 는 로그인한 사람에게만 열리므로, 누구나 보는 명부는 이 뷰로만 채운다.
   */
  async listPublicPairs(): Promise<PublicPair[]> {
    const { data } = await requireSupabase().from('public_pairs').select('*').order('label');

    return (data ?? []).map((row) => ({
      id: row.id as string,
      label: (row.label as string) ?? '',
      hunterHandle: (row.hunter_handle as string | null) ?? null,
      constellationHandle: (row.constellation_handle as string | null) ?? null,
      hunterName: (row.hunter_name as string) ?? '',
      constellationName: (row.constellation_name as string) ?? '',
      affiliation: row.affiliation as PublicPair['affiliation'],
      createdAt: (row.created_at as string) ?? new Date().toISOString(),
    }));
  }

  async saveBond(bond: PairBond): Promise<void> {
    const { error } = await requireSupabase().from('pair_bonds').upsert({
      id: bond.id,
      label: bond.label,
      hunter_handle: bond.hunterAccountId,
      constellation_handle: bond.constellationAccountId,
      hunter_name: bond.hunterName,
      constellation_name: bond.constellationName,
      affiliation: bond.affiliation,
      active: bond.active,
      points: bond.points ?? 0,
      inventory: bond.inventory ?? [],
    });
    if (error) throw new Error(`편성 저장 실패: ${error.message}`);
  }

  async deleteBond(id: string): Promise<void> {
    const { error } = await requireSupabase().from('pair_bonds').delete().eq('id', id);
    if (error) throw new Error(`편성 삭제 실패: ${error.message}`);
  }

  /* ── 적 세팅 ── */

  async listEnemyTemplates(): Promise<EnemyTemplate[]> {
    const { data } = await requireSupabase().from('enemy_templates').select('*').order('name');

    return (data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      grade: row.grade as string,
      maxHp: row.max_hp as number,
      attack: row.attack as number,
      defense: row.defense as number,
      maxPhase: row.max_phase as number,
      patternSetId: (row.pattern_set_id as string) ?? null,
      attacks: (row.attacks as EnemyTemplate['attacks']) ?? [],
      phaseCutoffs: (row.phase_cutoffs as number[]) ?? [],
      boss: Boolean(row.boss),
    }));
  }

  async saveEnemyTemplate(template: EnemyTemplate): Promise<void> {
    const { error } = await requireSupabase().from('enemy_templates').upsert({
      id: template.id,
      name: template.name,
      grade: template.grade,
      max_hp: template.maxHp,
      attack: template.attack,
      defense: template.defense,
      max_phase: template.maxPhase,
      pattern_set_id: template.patternSetId,
      attacks: template.attacks ?? [],
      phase_cutoffs: template.phaseCutoffs ?? [],
      boss: template.boss,
    });
    if (error) throw new Error(`적 저장 실패: ${error.message}`);
  }

  async deleteEnemyTemplate(id: string): Promise<void> {
    const { error } = await requireSupabase().from('enemy_templates').delete().eq('id', id);
    if (error) throw new Error(`적 삭제 실패: ${error.message}`);
  }

  /* ── 상점 진열 ── */

  async listItems(): Promise<ShopItemRecord[]> {
    const { data } = await requireSupabase().from('shop_items').select('*').order('sort');

    return (data ?? []).map((row) => ({
      itemId: row.item_id as string,
      price: row.price as number,
      limit: (row.buy_limit as number | null) ?? null,
      active: Boolean(row.active),
      sort: (row.sort as number) ?? 0,
      item: (row.item as ShopItemRecord['item']) ?? null,
    }));
  }

  async saveItem(record: ShopItemRecord): Promise<void> {
    const { error } = await requireSupabase().from('shop_items').upsert({
      item_id: record.itemId,
      price: record.price,
      buy_limit: record.limit,
      active: record.active,
      sort: record.sort,
      item: record.item,
    });
    if (error) throw new Error(`상점 저장 실패: ${error.message}`);
  }

  async deleteItem(itemId: string): Promise<void> {
    const { error } = await requireSupabase().from('shop_items').delete().eq('item_id', itemId);
    if (error) throw new Error(`상점 삭제 실패: ${error.message}`);
  }

  /* ── 룰렛 원반 ── */

  async listWheels(): Promise<RouletteWheel[]> {
    const { data } = await requireSupabase().from('roulette_wheels').select('*').order('sort');

    return (data ?? []).map((row) => ({
      id: row.id as string,
      name: (row.name as string) ?? '',
      description: (row.description as string) ?? '',
      entryFee: (row.entry_fee as number) ?? 0,
      slots: (row.slots as RouletteWheel['slots']) ?? [],
      active: Boolean(row.active),
      sort: (row.sort as number) ?? 0,
    }));
  }

  async saveWheel(wheel: RouletteWheel): Promise<void> {
    const { error } = await requireSupabase().from('roulette_wheels').upsert({
      id: wheel.id,
      name: wheel.name,
      description: wheel.description,
      entry_fee: wheel.entryFee,
      slots: wheel.slots,
      active: wheel.active,
      sort: wheel.sort,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`원반 저장 실패: ${error.message}`);
  }

  async deleteWheel(id: string): Promise<void> {
    const { error } = await requireSupabase().from('roulette_wheels').delete().eq('id', id);
    if (error) throw new Error(`원반 삭제 실패: ${error.message}`);
  }

  /**
   * 회전 기록 한 줄을 지운다 — 운영진만 통과한다 (0019 · spins operator delete).
   * 뷰가 아니라 원본 표를 지운다. 지워도 소지금은 그대로다 — 기록은 전광판일 뿐이다.
   */
  async deleteSpin(id: string): Promise<void> {
    const { error } = await requireSupabase().from('roulette_spins').delete().eq('id', id);
    if (error) throw new Error(`회전 기록 삭제 실패: ${error.message}`);
  }

  async clearSpins(): Promise<void> {
    // 조건 없는 delete 는 거절되므로 언제나 참인 조건을 하나 준다
    const { error } = await requireSupabase()
      .from('roulette_spins')
      .delete()
      .gte('created_at', '1970-01-01');
    if (error) throw new Error(`회전 기록 비우기 실패: ${error.message}`);
  }

  /**
   * 전광판 — 뷰(`roulette_board`)를 읽는다.
   * 표를 직접 읽으면 RLS 가 자기 기록만 주므로, 남이 딴 것은 뷰로만 보인다.
   */
  /* ── 운영 감사 기록 ── */

  async record(draft: AuditDraft): Promise<void> {
    /*
       by_account 는 적지 않는다 — 표의 기본값이 auth.uid() 라 서버가 채운다.
       브라우저가 보내면 남의 이름으로 적을 수 있다.
    */
    const { error } = await requireSupabase().from('ops_audit').insert({
      target_account: draft.targetAccountId || null,
      target_name: draft.targetName,
      action: draft.action,
      summary: draft.summary,
      reason: draft.reason,
      before_value: draft.before,
      after_value: draft.after,
    });
    if (error) throw new Error(`감사 기록 실패: ${error.message}`);
  }

  async listAudit(limit = 200): Promise<AuditEntry[]> {
    const { data } = await requireSupabase()
      .from('ops_audit')
      .select('*')
      .order('at', { ascending: false })
      .limit(limit);

    return (data ?? []).map((row) => ({
      id: row.id as string,
      at: (row.at as string) ?? new Date().toISOString(),
      byHandle: (row.by_handle as string) ?? '관리국',
      targetAccountId: (row.target_account as string | null) ?? '',
      targetName: (row.target_name as string) ?? '',
      action: row.action as AuditEntry['action'],
      summary: (row.summary as string) ?? '',
      reason: (row.reason as string | null) ?? null,
      before: (row.before_value as number | null) ?? null,
      after: (row.after_value as number | null) ?? null,
    }));
  }

  async recentSpins(limit = 50): Promise<RouletteSpin[]> {
    const { data } = await requireSupabase()
      .from('roulette_board')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    return (data ?? []).map((row) => ({
      id: row.id as string,
      wheelId: (row.wheel_id as string | null) ?? null,
      wheelName: (row.wheel_name as string) ?? '',
      spinnerName: (row.spinner_name as string) ?? '',
      slotIndex: (row.slot_index as number) ?? 0,
      label: (row.label as string) ?? '',
      payout: (row.payout as number) ?? 0,
      fee: (row.fee as number) ?? 0,
      net: (row.net as number) ?? 0,
      at: (row.created_at as string) ?? new Date().toISOString(),
    }));
  }

  /* ── 채팅 ── */

  async listMessages(channel: string, limit = 200): Promise<ChatMessage[]> {
    const { data, error } = await requireSupabase()
      .from('chat_messages')
      .select('*')
      .eq('channel', channel)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`채팅을 불러올 수 없습니다: ${error.message}`);

    return (data ?? [])
      .map((row) => ({
        id: row.id as string,
        channel: row.channel as string,
        authorId: row.author_handle as string,
        authorName: row.author_name as string,
        role: row.role as ChatMessage['role'],
        side: (row.side as ChatMessage['side']) ?? null,
        kind: row.kind as ChatMessage['kind'],
        body: row.body as string,
        dice: (row.dice as ChatMessage['dice']) ?? null,
        at: row.created_at as string,
      }))
      .reverse();
  }

  async postMessage(message: ChatMessage): Promise<void> {
    const supabase = requireSupabase();
    const { data: auth } = await supabase.auth.getUser();

    const { error } = await supabase.from('chat_messages').insert({
      channel: message.channel,
      author: auth.user?.id ?? null,
      author_handle: message.authorId,
      author_name: message.authorName,
      role: message.role,
      side: message.side,
      kind: message.kind,
      body: message.body,
      dice: message.dice,
    });

    if (error) throw new Error(`전송 실패: ${error.message}`);
  }

  async deleteMessage(id: string): Promise<void> {
    const { error } = await requireSupabase().from('chat_messages').delete().eq('id', id);
    if (error) throw new Error(`삭제 실패: ${error.message}`);
  }

  /** 채팅 실시간 구독 — 안전망 폴링을 함께 건다 */
  subscribeChat(channel: string, onMessage: () => void): () => void {
    const supabase = requireSupabase();
    const timer = window.setInterval(onMessage, REALTIME_SAFETY_NET_MS);
    const realtime = supabase
      .channel(`chat:${channel}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_messages', filter: `channel=eq.${channel}` },
        onMessage,
      )
      .subscribe();

    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(realtime);
    };
  }

  async listBattles(): Promise<BattleSummary[]> {
    const { data } = await requireSupabase()
      .from('battles')
      .select('id, mode, operation, round, status, updated_at')
      .order('updated_at', { ascending: false });

    return (data ?? []).map((row) => ({
      id: row.id as string,
      mode: row.mode as BattleSummary['mode'],
      operationName: (row.operation as { name: string })?.name ?? '',
      round: row.round as number,
      status: row.status as BattleSummary['status'],
      updatedAt: row.updated_at as string,
    }));
  }

  async deleteBattle(id: string): Promise<void> {
    const { error } = await requireSupabase().from('battles').delete().eq('id', id);
    if (error) throw new Error(`삭제 실패: ${error.message}`);
  }

  async exportAll(): Promise<string> {
    const summaries = await this.listBattles();
    const battles: BattleState[] = [];
    for (const summary of summaries) {
      const state = await this.loadBattle(summary.id);
      if (state) battles.push(state);
    }
    const envelope: ExportEnvelope = {
      schemaVersion: battles[0]?.schemaVersion ?? SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      battles,
      bonds: await this.listBonds(),
      enemyTemplates: await this.listEnemyTemplates(),
      shopItems: await this.listItems(),
      rouletteWheels: await this.listWheels(),
      records: await this.listRecords(),
    };
    return JSON.stringify(envelope, null, 2);
  }

  async importAll(json: string): Promise<void> {
    const envelope = JSON.parse(json) as ExportEnvelope;
    for (const state of envelope.battles ?? []) {
      await this.saveBattle(state);
    }
    for (const bond of envelope.bonds ?? []) {
      await this.saveBond(bond);
    }
    for (const template of envelope.enemyTemplates ?? []) {
      await this.saveEnemyTemplate(template);
    }
    for (const row of envelope.shopItems ?? []) {
      await this.saveItem(row);
    }
    for (const wheel of envelope.rouletteWheels ?? []) {
      await this.saveWheel(wheel);
    }
    for (const record of envelope.records ?? []) {
      await this.saveRecord(record);
    }
  }

  /* ── 공략 기록 ── */

  async getPublicRecord(id: string): Promise<PublicRecord | null> {
    /* 표가 아니라 뷰를 읽는다 — 지갑과 운영 메모는 애초에 담기지 않는다 */
    const { data } = await requireSupabase()
      .from('public_records')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (!data) return null;
    return {
      id: data.id as string,
      mode: (data.mode as string) ?? 'DUEL',
      operation: (data.operation as PublicRecord['operation']) ?? {
        name: '',
        floor: 0,
        threatLevel: '',
      },
      status: data.status as PublicRecord['status'],
      rounds: (data.rounds as number) ?? 0,
      finishedAt: (data.finished_at as string) ?? new Date().toISOString(),
      bossName: (data.boss_name as string | null) ?? null,
      gimmick: (data.gimmick as PublicRecord['gimmick']) ?? null,
      pairs: (data.pairs as PublicRecord['pairs']) ?? [],
      log: (data.log as PublicRecord['log']) ?? [],
    };
  }

  async listRecords(): Promise<BattleRecord[]> {
    const { data, error } = await requireSupabase()
      .from('battle_records')
      .select('*')
      .order('finished_at', { ascending: false });

    if (error) throw new Error(`공략 기록을 불러올 수 없습니다: ${error.message}`);

    return (data ?? []).map((row) => ({
      id: row.id as string,
      schemaVersion: row.schema_version as number,
      battleId: row.battle_id as string,
      mode: row.mode as BattleRecord['mode'],
      operation: row.operation as BattleRecord['operation'],
      status: row.status as BattleRecord['status'],
      rounds: row.rounds as number,
      finishedAt: row.finished_at as string,
      bossName: (row.boss_name as string) ?? null,
      gimmick: (row.gimmick as BattleRecord['gimmick']) ?? null,
      pairs: (row.pairs as BattleRecord['pairs']) ?? [],
      log: (row.log as BattleRecord['log']) ?? [],
      note: (row.note as string) ?? '',
    }));
  }

  async saveRecord(record: BattleRecord): Promise<void> {
    const { error } = await requireSupabase().from('battle_records').upsert({
      id: record.id,
      schema_version: record.schemaVersion,
      battle_id: record.battleId,
      mode: record.mode,
      operation: record.operation,
      status: record.status,
      rounds: record.rounds,
      finished_at: record.finishedAt,
      boss_name: record.bossName,
      gimmick: record.gimmick,
      pairs: record.pairs,
      log: record.log,
      note: record.note,
    });
    if (error) throw new Error(`공략 기록 저장 실패: ${error.message}`);
  }

  async deleteRecord(id: string): Promise<void> {
    const { error } = await requireSupabase().from('battle_records').delete().eq('id', id);
    if (error) throw new Error(`공략 기록 삭제 실패: ${error.message}`);
  }

  /** 전투 상태 변경을 실시간으로 구독한다 — 안전망 폴링을 함께 건다 */
  subscribe(battleId: string, onChange: () => void): () => void {
    const supabase = requireSupabase();
    const timer = window.setInterval(onChange, REALTIME_SAFETY_NET_MS);
    const channel = supabase
      .channel(`battle:${battleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'battles', filter: `id=eq.${battleId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'battle_pairs', filter: `battle_id=eq.${battleId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'battle_log', filter: `battle_id=eq.${battleId}` }, onChange)
      .subscribe();

    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }
}
