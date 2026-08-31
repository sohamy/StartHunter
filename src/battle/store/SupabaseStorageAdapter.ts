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
import type { ExportEnvelope, StorageAdapter } from './StorageAdapter';
import type {
  ActorSide,
  BattleRecord,
  BattleState,
  BattleSummary,
  ChatMessage,
  EnemyTemplate,
  PairBond,
  ShopItemRecord,
  PairState,
  RoundSubmission,
} from '../types';

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

export class SupabaseStorageAdapter implements StorageAdapter {
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

  async listShopItems(): Promise<ShopItemRecord[]> {
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

  async saveShopItem(record: ShopItemRecord): Promise<void> {
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

  async deleteShopItem(itemId: string): Promise<void> {
    const { error } = await requireSupabase().from('shop_items').delete().eq('item_id', itemId);
    if (error) throw new Error(`상점 삭제 실패: ${error.message}`);
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

  /** 채팅 실시간 구독 */
  subscribeChat(channel: string, onMessage: () => void): () => void {
    const supabase = requireSupabase();
    const realtime = supabase
      .channel(`chat:${channel}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_messages', filter: `channel=eq.${channel}` },
        onMessage,
      )
      .subscribe();

    return () => {
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
      shopItems: await this.listShopItems(),
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
      await this.saveShopItem(row);
    }
    for (const record of envelope.records ?? []) {
      await this.saveRecord(record);
    }
  }

  /* ── 공략 기록 ── */

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

  /** 전투 상태 변경을 실시간으로 구독한다 */
  subscribe(battleId: string, onChange: () => void): () => void {
    const supabase = requireSupabase();
    const channel = supabase
      .channel(`battle:${battleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'battles', filter: `id=eq.${battleId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'battle_pairs', filter: `battle_id=eq.${battleId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'battle_log', filter: `battle_id=eq.${battleId}` }, onChange)
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }
}
