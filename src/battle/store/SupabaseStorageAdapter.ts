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

import { requireSupabase } from './supabaseClient';
import type { ExportEnvelope, StorageAdapter } from './StorageAdapter';
import type {
  ActorSide,
  BattleState,
  BattleSummary,
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
  points: number;
  pattern_revealed: boolean;
}

interface SubmissionRow {
  pair_id: string;
  round: number;
  hunter_action_id: string | null;
  constellation_action_id: string | null;
  target_enemy_id: string | null;
  support_target_pair_id: string | null;
  hunter_submitted: boolean;
  constellation_submitted: boolean;
}

function emptySubmissionRow(): RoundSubmission {
  return {
    hunterActionId: null,
    constellationActionId: null,
    targetEnemyId: null,
    supportTargetPairId: null,
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
    hunterSubmitted: row.hunter_submitted,
    constellationSubmitted: row.constellation_submitted,
  };
}

export class SupabaseStorageAdapter implements StorageAdapter {
  async loadBattle(id: string): Promise<BattleState | null> {
    const supabase = requireSupabase();

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
      return {
        id: row.id,
        label: row.label,
        affiliation: row.affiliation,
        hunterAccountId: row.hunter_account,
        constellationAccountId: row.constellation_account,
        hunter: row.hunter,
        constellation: row.constellation,
        contract: row.contract,
        points: row.points,
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
    };
  }

  /** 운영진 전용 — RLS 가 참가자의 호출을 거부한다. */
  async saveBattle(state: BattleState): Promise<void> {
    const supabase = requireSupabase();

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
    });
    if (battleError) throw new Error(`전투 저장 실패: ${battleError.message}`);

    for (const [index, pair] of state.pairs.entries()) {
      const { error } = await supabase.from('battle_pairs').upsert({
        id: pair.id,
        battle_id: state.id,
        ordinal: index,
        label: pair.label,
        affiliation: pair.affiliation,
        hunter_account: pair.hunterAccountId,
        constellation_account: pair.constellationAccountId,
        hunter: pair.hunter,
        constellation: pair.constellation,
        contract: pair.contract,
        points: pair.points,
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
    } else {
      if (patch.actionId !== undefined) update.constellation_action_id = patch.actionId;
      if (patch.submitted !== undefined) update.constellation_submitted = patch.submitted;
    }

    if (Object.keys(update).length === 0) return;

    const { error } = await supabase
      .from('submissions')
      .update(update)
      .eq('pair_id', pairId)
      .eq('round', round);

    if (error) throw new Error(`제출 실패: ${error.message}`);
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
      schemaVersion: battles[0]?.schemaVersion ?? 0,
      exportedAt: new Date().toISOString(),
      battles,
    };
    return JSON.stringify(envelope, null, 2);
  }

  async importAll(json: string): Promise<void> {
    const envelope = JSON.parse(json) as ExportEnvelope;
    for (const state of envelope.battles ?? []) {
      await this.saveBattle(state);
    }
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
