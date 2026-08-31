-- ============================================================
--  아이템 · 포인트 원장 · 공략 기록
--
--  0001~0005 를 적용한 뒤 SQL Editor 에 붙여 실행한다.
--
--  1. 페어가 공용 가방(inventory)을 들고 다닌다.
--  2. 아이템 행동으로 무엇을 쓰는지 쪽별로 제출한다.
--  3. 포인트 지급 내역을 원장(battles.rewards)에 남긴다 — 합계만 남기면 근거를 잃는다.
--  4. 편성(pair_bonds)이 공략 사이에도 포인트와 보급품을 유지한다.
--  5. 끝난 전투를 공략 기록(battle_records)으로 보관한다.
-- ============================================================

-- ── 전투 중 가방 ────────────────────────────────────────
alter table public.battle_pairs
  add column if not exists inventory jsonb not null default '[]'::jsonb;

comment on column public.battle_pairs.inventory is
  '페어 공용 가방. [{ itemId, quantity }] — 정의는 config/items.ts 에 있다.';

-- ── 포인트 원장 ─────────────────────────────────────────
alter table public.battles
  add column if not exists rewards jsonb not null default '[]'::jsonb;

comment on column public.battles.rewards is
  '포인트 지급 내역. [{ id, round, pairId, reason, label, points }]';

-- ── 아이템 제출 ─────────────────────────────────────────
alter table public.submissions
  add column if not exists hunter_item_id        text,
  add column if not exists constellation_item_id text;

comment on column public.submissions.hunter_item_id is
  '헌터가 아이템 행동으로 쓰려는 아이템 id';
comment on column public.submissions.constellation_item_id is
  '성좌가 성유물 행동으로 쓰려는 아이템 id';

-- 쪽별 제출 보호 트리거에 아이템 칼럼을 포함한다.
-- 헌터 아이템은 헌터만, 성유물은 성좌만 고를 수 있다.
create or replace function public.enforce_submission_side()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  is_hunter boolean;
  is_constellation boolean;
begin
  if public.is_operator() then
    return new;
  end if;

  select bp.hunter_account = auth.uid(), bp.constellation_account = auth.uid()
    into is_hunter, is_constellation
  from public.battle_pairs bp
  where bp.id = new.pair_id;

  if coalesce(is_hunter, false) then
    if new.constellation_action_id is distinct from old.constellation_action_id
       or new.constellation_submitted is distinct from old.constellation_submitted
       or new.constellation_item_id is distinct from old.constellation_item_id then
      raise exception '성좌 쪽 제출은 성좌 참가자만 변경할 수 있습니다';
    end if;
    return new;
  end if;

  if coalesce(is_constellation, false) then
    if new.hunter_action_id is distinct from old.hunter_action_id
       or new.hunter_submitted is distinct from old.hunter_submitted
       or new.target_enemy_id is distinct from old.target_enemy_id
       or new.support_target_pair_id is distinct from old.support_target_pair_id
       or new.gimmick_note is distinct from old.gimmick_note
       or new.gimmick_stage is distinct from old.gimmick_stage
       or new.gimmick_check is distinct from old.gimmick_check
       or new.hunter_item_id is distinct from old.hunter_item_id then
      raise exception '헌터 쪽 제출은 헌터 참가자만 변경할 수 있습니다';
    end if;
    return new;
  end if;

  raise exception '이 페어의 참가자가 아닙니다';
end;
$$;

-- ── 영구 편성이 들고 다니는 포인트 · 보급품 ─────────────
alter table public.pair_bonds
  add column if not exists points    integer not null default 450,
  add column if not exists inventory jsonb   not null default '[]'::jsonb;

comment on column public.pair_bonds.points is
  '공략 사이에도 유지되는 페어 공용 상점 화폐. 전투 정산에서 갱신된다.';
comment on column public.pair_bonds.inventory is
  '공략 사이에도 유지되는 보급품. 전투에서 쓴 만큼 줄어든다.';

-- ── 공략 기록 ───────────────────────────────────────────
create table if not exists public.battle_records (
  id             text primary key,
  schema_version integer not null,
  -- 원본 전투가 지워져도 기록은 남는다 — 참조 제약을 걸지 않는다.
  battle_id      text not null,
  mode           text not null check (mode in ('DUEL', 'RAID')),
  operation      jsonb not null default '{}'::jsonb,
  status         text not null check (status in ('PREPARING', 'ENGAGED', 'CLEARED', 'FAILED')),
  rounds         integer not null default 0,
  finished_at    timestamptz not null default now(),
  boss_name      text,
  gimmick        jsonb,
  pairs          jsonb not null default '[]'::jsonb,
  log            jsonb not null default '[]'::jsonb,
  note           text not null default '',
  created_at     timestamptz not null default now()
);

create index if not exists battle_records_finished_idx
  on public.battle_records (finished_at desc);

alter table public.battle_records enable row level security;

-- 읽기 — 참가자도 자기 공략 기록을 볼 수 있어야 한다
drop policy if exists "records readable" on public.battle_records;
create policy "records readable" on public.battle_records
  for select to authenticated using (true);

-- 보관 · 수정 · 삭제 — 운영진만
drop policy if exists "records insert operator" on public.battle_records;
create policy "records insert operator" on public.battle_records
  for insert to authenticated with check (public.is_operator());

drop policy if exists "records update operator" on public.battle_records;
create policy "records update operator" on public.battle_records
  for update to authenticated
  using (public.is_operator()) with check (public.is_operator());

drop policy if exists "records delete operator" on public.battle_records;
create policy "records delete operator" on public.battle_records
  for delete to authenticated using (public.is_operator());
