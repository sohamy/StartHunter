-- ============================================================
--  영구 편성(페어)과 적 세팅
--
--  0001 을 적용한 뒤 SQL Editor 에 붙여 실행한다.
--
--  페어는 한 번 맺으면 공략 내내 유지된다. 전투마다 다시 짝을 짓지 않고,
--  "등록된 페어 중 누가 이 전투에 참가하는가"만 고른다.
-- ============================================================

-- ── 영구 편성 ───────────────────────────────────────────
create table if not exists public.pair_bonds (
  id                     uuid primary key default gen_random_uuid(),
  label                  text not null,
  -- 활동명(handle)으로 참조한다. 프론트엔드가 handle 로 계정을 식별한다.
  hunter_handle          text references public.profiles (handle) on update cascade,
  constellation_handle   text references public.profiles (handle) on update cascade,
  hunter_name            text not null default '',
  constellation_name     text not null default '',
  affiliation            text not null default 'GOVERNMENT'
                           check (affiliation in ('GOVERNMENT', 'PRIVATE_GUILD')),
  active                 boolean not null default true,
  created_at             timestamptz not null default now(),
  -- 한 사람이 페어의 양쪽을 맡을 수 없다
  constraint bond_distinct check (
    hunter_handle is null
    or constellation_handle is null
    or hunter_handle <> constellation_handle
  )
);

-- 한 참가자는 활성 페어 하나만 가진다 (영구 페어)
create unique index if not exists pair_bonds_hunter_active
  on public.pair_bonds (hunter_handle) where active and hunter_handle is not null;
create unique index if not exists pair_bonds_constellation_active
  on public.pair_bonds (constellation_handle) where active and constellation_handle is not null;

-- profiles.handle 을 외래키로 쓰려면 유니크 제약이 필요하다 (0001 에서 이미 unique)
-- ── 적 세팅 ─────────────────────────────────────────────
create table if not exists public.enemy_templates (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  grade            text not null default 'NORMAL / C',
  max_hp           int not null default 200 check (max_hp > 0),
  attack           int not null default 10 check (attack >= 0),
  defense          int not null default 3 check (defense >= 0),
  max_phase        int not null default 1 check (max_phase >= 1),
  pattern_set_id   text,
  boss             boolean not null default false,
  created_at       timestamptz not null default now()
);

-- ============================================================
--  RLS — 조회는 모두, 편집은 운영진만
-- ============================================================

alter table public.pair_bonds      enable row level security;
alter table public.enemy_templates enable row level security;

drop policy if exists "bonds readable" on public.pair_bonds;
create policy "bonds readable" on public.pair_bonds
  for select to authenticated using (true);

drop policy if exists "bonds operator write" on public.pair_bonds;
create policy "bonds operator write" on public.pair_bonds
  for all to authenticated using (public.is_operator()) with check (public.is_operator());

-- 적 능력치는 참가자에게 감춘다 — 운영진만 조회 가능
drop policy if exists "enemies operator only" on public.enemy_templates;
create policy "enemies operator only" on public.enemy_templates
  for all to authenticated using (public.is_operator()) with check (public.is_operator());

-- ── Realtime ────────────────────────────────────────────
do $$
begin
  execute 'alter publication supabase_realtime add table public.pair_bonds';
exception when duplicate_object then null;
end $$;
