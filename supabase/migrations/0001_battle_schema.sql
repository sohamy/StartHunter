-- ============================================================
--  TOWER RAID CONTROL — 스키마 및 접근 정책
--
--  Supabase 대시보드 → SQL Editor 에 붙여 실행한다.
--
--  핵심 원칙
--   1. 1인 = 1캐릭터. 헌터와 성좌는 서로 다른 계정이다.
--      한 계정이 한 페어의 양쪽을 맡는 것은 DB 제약으로 막는다.
--   2. 참가자는 자기 쪽 제출만 쓸 수 있다.
--   3. 전투 상태 변경(라운드 처리 · 편성 · 강제 AUTO)은 운영진만 가능하다.
--   4. 보스의 다음 패턴처럼 감춰야 하는 정보는 참가자에게 내려보내지 않는다.
-- ============================================================

-- ── 확장 ────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ── 프로필 (계정) ───────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  handle      text not null unique,
  role        text not null default 'PARTICIPANT'
                check (role in ('PARTICIPANT', 'OPERATOR')),
  created_at  timestamptz not null default now()
);

comment on column public.profiles.role is
  '운영진은 OPERATOR. 승격은 대시보드에서 직접 UPDATE 한다.';

-- 회원가입 시 프로필 자동 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, handle)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'handle', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 운영진 판정 헬퍼
create or replace function public.is_operator()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'OPERATOR'
  );
$$;

-- ── 캐릭터 시트 ─────────────────────────────────────────
create table if not exists public.sheets (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null references public.profiles on delete cascade,
  side         text not null check (side in ('HUNTER', 'CONSTELLATION')),
  name         text not null,
  class_id     text not null,
  stats        jsonb not null default '{}'::jsonb,
  skills       jsonb not null default '[]'::jsonb,
  concept      text not null default '',
  affiliation  text not null default 'GOVERNMENT'
                 check (affiliation in ('GOVERNMENT', 'PRIVATE_GUILD')),
  created_at   timestamptz not null default now(),
  -- 1인 = 1캐릭터
  unique (owner)
);

-- 다른 참가자에게 공개해도 되는 정보만 노출하는 뷰
create or replace view public.public_profiles
with (security_invoker = true) as
  select p.id as account_id, p.handle, s.side, s.name, s.class_id
  from public.profiles p
  join public.sheets s on s.owner = p.id;

-- ── 전투 ────────────────────────────────────────────────
create table if not exists public.battles (
  id              uuid primary key default gen_random_uuid(),
  schema_version  int not null,
  mode            text not null check (mode in ('DUEL', 'RAID')),
  operation       jsonb not null,
  round           int not null default 1,
  status          text not null default 'ENGAGED'
                    check (status in ('PREPARING', 'ENGAGED', 'CLEARED', 'FAILED')),
  enemies         jsonb not null default '[]'::jsonb,
  gimmick         jsonb,
  alerts          jsonb not null default '[]'::jsonb,
  created_by      uuid references public.profiles,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── 페어 (편성) ─────────────────────────────────────────
create table if not exists public.battle_pairs (
  id                        uuid primary key default gen_random_uuid(),
  battle_id                 uuid not null references public.battles on delete cascade,
  ordinal                   int not null,
  label                     text not null,
  affiliation               text not null,
  hunter_account            uuid references public.profiles,
  constellation_account     uuid references public.profiles,
  hunter                    jsonb not null,
  constellation             jsonb not null,
  contract                  jsonb not null,
  points                    int not null default 0,
  pattern_revealed          boolean not null default false,
  unique (battle_id, ordinal),
  -- 한 사람이 양쪽을 맡을 수 없다
  constraint pair_distinct_accounts check (
    hunter_account is null
    or constellation_account is null
    or hunter_account <> constellation_account
  )
);

-- 같은 전투에서 한 계정이 두 자리를 차지하지 못하게 한다
create unique index if not exists battle_pairs_hunter_unique
  on public.battle_pairs (battle_id, hunter_account)
  where hunter_account is not null;
create unique index if not exists battle_pairs_constellation_unique
  on public.battle_pairs (battle_id, constellation_account)
  where constellation_account is not null;

-- ── 제출 ────────────────────────────────────────────────
create table if not exists public.submissions (
  pair_id                   uuid not null references public.battle_pairs on delete cascade,
  round                     int not null,
  hunter_action_id          text,
  constellation_action_id   text,
  target_enemy_id           text,
  support_target_pair_id    uuid,
  hunter_submitted          boolean not null default false,
  constellation_submitted   boolean not null default false,
  updated_at                timestamptz not null default now(),
  primary key (pair_id, round)
);

-- ── 로그 ────────────────────────────────────────────────
create table if not exists public.battle_log (
  id          uuid primary key default gen_random_uuid(),
  battle_id   uuid not null references public.battles on delete cascade,
  round       int not null,
  channel     text not null check (channel in ('SYSTEM', 'ROLEPLAY')),
  at          text not null,
  pair_id     uuid,
  text        text not null,
  detail      text,
  edited      boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists battle_log_battle_idx on public.battle_log (battle_id, created_at);

-- ============================================================
--  ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles      enable row level security;
alter table public.sheets        enable row level security;
alter table public.battles       enable row level security;
alter table public.battle_pairs  enable row level security;
alter table public.submissions   enable row level security;
alter table public.battle_log    enable row level security;

-- ── profiles ────────────────────────────────────────────
drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ── sheets ──────────────────────────────────────────────
-- 본인 시트와 운영진만 전체 조회. 남의 스탯·스킬은 보이지 않는다.
drop policy if exists "sheets read own" on public.sheets;
create policy "sheets read own" on public.sheets
  for select to authenticated using (owner = auth.uid() or public.is_operator());

drop policy if exists "sheets insert own" on public.sheets;
create policy "sheets insert own" on public.sheets
  for insert to authenticated with check (owner = auth.uid());

drop policy if exists "sheets update own" on public.sheets;
create policy "sheets update own" on public.sheets
  for update to authenticated
  using (owner = auth.uid() or public.is_operator())
  with check (owner = auth.uid() or public.is_operator());

-- ── battles ─────────────────────────────────────────────
drop policy if exists "battles readable" on public.battles;
create policy "battles readable" on public.battles
  for select to authenticated using (true);

drop policy if exists "battles operator write" on public.battles;
create policy "battles operator write" on public.battles
  for all to authenticated using (public.is_operator()) with check (public.is_operator());

-- ── battle_pairs ────────────────────────────────────────
drop policy if exists "pairs readable" on public.battle_pairs;
create policy "pairs readable" on public.battle_pairs
  for select to authenticated using (true);

-- 편성 · 상태 변경 · 강제 AUTO 는 운영진만
drop policy if exists "pairs operator write" on public.battle_pairs;
create policy "pairs operator write" on public.battle_pairs
  for all to authenticated using (public.is_operator()) with check (public.is_operator());

-- ── submissions ─────────────────────────────────────────
-- 같은 페어 구성원과 운영진만 조회
drop policy if exists "submissions readable" on public.submissions;
create policy "submissions readable" on public.submissions
  for select to authenticated using (
    public.is_operator()
    or exists (
      select 1 from public.battle_pairs bp
      where bp.id = pair_id
        and (bp.hunter_account = auth.uid() or bp.constellation_account = auth.uid())
    )
  );

-- 페어 구성원은 자기 라운드 행을 만들 수 있다
drop policy if exists "submissions insert member" on public.submissions;
create policy "submissions insert member" on public.submissions
  for insert to authenticated with check (
    public.is_operator()
    or exists (
      select 1 from public.battle_pairs bp
      where bp.id = pair_id
        and (bp.hunter_account = auth.uid() or bp.constellation_account = auth.uid())
    )
  );

-- 갱신은 자기 쪽만. 상대 쪽 값을 건드리면 아래 트리거가 막는다.
drop policy if exists "submissions update member" on public.submissions;
create policy "submissions update member" on public.submissions
  for update to authenticated using (
    public.is_operator()
    or exists (
      select 1 from public.battle_pairs bp
      where bp.id = pair_id
        and (bp.hunter_account = auth.uid() or bp.constellation_account = auth.uid())
    )
  );

-- 자기 쪽 칼럼만 바꿀 수 있게 강제한다
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
    -- 성좌 쪽 값은 이전 값을 유지해야 한다
    if new.constellation_action_id is distinct from old.constellation_action_id
       or new.constellation_submitted is distinct from old.constellation_submitted then
      raise exception '성좌 쪽 제출은 성좌 참가자만 변경할 수 있습니다';
    end if;
    return new;
  end if;

  if coalesce(is_constellation, false) then
    if new.hunter_action_id is distinct from old.hunter_action_id
       or new.hunter_submitted is distinct from old.hunter_submitted
       or new.target_enemy_id is distinct from old.target_enemy_id
       or new.support_target_pair_id is distinct from old.support_target_pair_id then
      raise exception '헌터 쪽 제출은 헌터 참가자만 변경할 수 있습니다';
    end if;
    return new;
  end if;

  raise exception '이 페어의 참가자가 아닙니다';
end;
$$;

drop trigger if exists submissions_side_guard on public.submissions;
create trigger submissions_side_guard
  before update on public.submissions
  for each row execute function public.enforce_submission_side();

-- ── battle_log ──────────────────────────────────────────
drop policy if exists "log readable" on public.battle_log;
create policy "log readable" on public.battle_log
  for select to authenticated using (true);

drop policy if exists "log operator write" on public.battle_log;
create policy "log operator write" on public.battle_log
  for all to authenticated using (public.is_operator()) with check (public.is_operator());

-- ── Realtime ────────────────────────────────────────────
-- 상대 제출과 라운드 결과가 즉시 반영되도록 구독 대상에 넣는다.
do $$
begin
  execute 'alter publication supabase_realtime add table public.battles';
exception when duplicate_object then null;
end $$;
do $$
begin
  execute 'alter publication supabase_realtime add table public.battle_pairs';
exception when duplicate_object then null;
end $$;
do $$
begin
  execute 'alter publication supabase_realtime add table public.submissions';
exception when duplicate_object then null;
end $$;
do $$
begin
  execute 'alter publication supabase_realtime add table public.battle_log';
exception when duplicate_object then null;
end $$;

-- ── updated_at 자동 갱신 ────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists battles_touch on public.battles;
create trigger battles_touch before update on public.battles
  for each row execute function public.touch_updated_at();

drop trigger if exists submissions_touch on public.submissions;
create trigger submissions_touch before update on public.submissions
  for each row execute function public.touch_updated_at();
