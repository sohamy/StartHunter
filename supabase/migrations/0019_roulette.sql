-- ============================================================
--  포인트 도박장 — 룰렛
--
--  0018 까지 적용한 뒤 SQL Editor 에 붙여 실행한다.
--
--  참가비를 내고 원반을 돌린다. 멈춘 칸에 적힌 만큼 소지금을 받는다.
--  칸도 확률도 참가비도 **운영진이 정한다** — 코드에는 기본 목록을 두지 않는다.
--
--  돌리는 것은 서버가 한다. 브라우저가 뽑아서 보내면 원하는 칸을 적어 보낼 수 있으므로,
--  어느 칸에 걸렸는지는 roulette_spin() 안에서만 정해진다.
--  화면의 회전 연출은 서버가 정한 결과를 뒤늦게 따라 돌 뿐이다.
--
--  소지금은 0015 부터 트리거가 지킨다 — 이 함수도 창구와 같은 표식을 세우고 지나간다.
-- ============================================================

-- ── 1 · 원반 ────────────────────────────────────────────
--  slots: [{ "label": "꽝", "payout": 0, "weight": 40 }, ...]
--    · payout — 걸리면 받는 P. 0 이면 꽝이다.
--    · weight — 뽑힐 무게. 확률은 이 값을 전체 합으로 나눈 것이다.
--      (확률을 % 로 직접 적게 하면 합이 100 이 아닐 때 처리가 애매해진다.
--       무게로 두면 칸을 더하고 빼도 나머지 칸끼리의 비율은 그대로 유지된다.)
create table if not exists public.roulette_wheels (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text not null default '',
  entry_fee   int  not null default 0 check (entry_fee >= 0),
  slots       jsonb not null default '[]'::jsonb,
  active      boolean not null default true,
  sort        int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.roulette_wheels is
  '룰렛 원반. 칸 · 확률(무게) · 참가비를 운영진이 정한다. 참가자는 읽기만 한다.';
comment on column public.roulette_wheels.slots is
  '칸 목록 — [{label, payout, weight}]. 확률은 weight 를 전체 합으로 나눈 값이다.';

alter table public.roulette_wheels enable row level security;

-- 가격표와 같다 — 무엇이 걸려 있고 확률이 얼마인지는 참가자도 본다
drop policy if exists "roulette readable" on public.roulette_wheels;
create policy "roulette readable" on public.roulette_wheels
  for select to authenticated using (true);

drop policy if exists "roulette operator write" on public.roulette_wheels;
create policy "roulette operator write" on public.roulette_wheels
  for all to authenticated using (public.is_operator()) with check (public.is_operator());

-- ── 2 · 회전 기록 ───────────────────────────────────────
--  누가 언제 무엇에 걸렸는지 남긴다. 운영진의 확인용이자 도박장의 전광판이다.
create table if not exists public.roulette_spins (
  id           uuid primary key default gen_random_uuid(),
  wheel_id     uuid references public.roulette_wheels on delete set null,
  wheel_name   text not null,
  account      uuid not null references public.profiles on delete cascade,
  spinner_name text not null,
  slot_index   int  not null,
  label        text not null,
  payout       int  not null,
  fee          int  not null,
  -- 참가비를 뺀 손익. 양수면 딴 것이고 음수면 잃은 것이다.
  net          int  not null,
  -- 돌리고 난 뒤의 소지금
  points       int  not null,
  created_at   timestamptz not null default now()
);

create index if not exists roulette_spins_recent on public.roulette_spins (created_at desc);
create index if not exists roulette_spins_mine on public.roulette_spins (account, created_at desc);

comment on table public.roulette_spins is
  '룰렛 회전 기록. 쓰는 길은 roulette_spin() 뿐이다 — insert 정책을 두지 않는다.';

alter table public.roulette_spins enable row level security;

-- 자기 기록과 운영진만 원본을 본다 (계정 id 와 소지금이 들어 있다)
drop policy if exists "spins read own" on public.roulette_spins;
create policy "spins read own" on public.roulette_spins
  for select to authenticated using (account = auth.uid() or public.is_operator());

-- 지우는 것은 운영진만. 넣는 정책은 두지 않는다 — 함수(security definer)만 쓴다.
drop policy if exists "spins operator delete" on public.roulette_spins;
create policy "spins operator delete" on public.roulette_spins
  for delete to authenticated using (public.is_operator());

-- ── 3 · 전광판 ──────────────────────────────────────────
--  최근에 누가 무엇에 걸렸는지. 계정 id 와 소지금은 싣지 않는다 —
--  이름과 걸린 칸은 도박장에서 어차피 서로 보는 값이다.
create or replace view public.roulette_board
with (security_invoker = false) as
  select
    s.id,
    s.wheel_id,
    s.wheel_name,
    s.spinner_name,
    s.slot_index,
    s.label,
    s.payout,
    s.fee,
    s.net,
    s.created_at
  from public.roulette_spins s
  order by s.created_at desc
  limit 200;

grant select on public.roulette_board to authenticated;

comment on view public.roulette_board is
  '도박장 전광판 — 최근 200회. 이름과 걸린 칸만 싣고 계정 정보와 소지금은 담지 않는다.';

-- ── 4 · 돌린다 ──────────────────────────────────────────
--  참가비를 먼저 떼고, 서버가 무게에 따라 칸을 뽑고, 그 칸의 값을 준다.
--  뽑기는 이 안에서만 일어난다 — 브라우저는 어느 원반을 돌릴지만 보낸다.
create or replace function public.roulette_spin(p_wheel_id uuid)
returns table (points int, slot_index int, label text, payout int, fee int, net int)
language plpgsql
security definer set search_path = public
as $fn$
declare
  v_sheet   public.sheets%rowtype;
  v_wheel   public.roulette_wheels%rowtype;
  v_total   numeric;
  v_roll    numeric;
  v_acc     numeric := 0;
  v_index   int;
  v_slot    jsonb;
  v_pick    int := null;
  v_label   text := '';
  v_payout  int  := 0;
  v_points  int;
begin
  select * into v_sheet from public.sheets where owner = auth.uid();
  if not found then
    raise exception '등록된 시트가 없습니다.';
  end if;

  if public.is_deployed(auth.uid()) then
    raise exception '전투에 배치된 동안에는 돌릴 수 없습니다.';
  end if;

  select * into v_wheel from public.roulette_wheels where id = p_wheel_id and active;
  if not found then
    raise exception '지금 돌릴 수 없는 원반입니다.';
  end if;

  if jsonb_typeof(v_wheel.slots) <> 'array' or jsonb_array_length(v_wheel.slots) = 0 then
    raise exception '칸이 하나도 없는 원반입니다.';
  end if;

  -- 무게의 합이 곧 분모다. 음수 무게는 0 으로 본다.
  select sum(greatest(coalesce((value ->> 'weight')::numeric, 0), 0))
    into v_total
    from jsonb_array_elements(v_wheel.slots);

  if v_total is null or v_total <= 0 then
    raise exception '확률이 정해지지 않은 원반입니다.';
  end if;

  if v_sheet.points < v_wheel.entry_fee then
    raise exception '참가비가 모자랍니다. (참가비 %P · 보유 %P)', v_wheel.entry_fee, v_sheet.points;
  end if;

  -- 뽑기 — 누적 무게가 굴린 값을 넘어서는 첫 칸이 당첨이다
  v_roll := random() * v_total;

  for v_index, v_slot in
    select (ordinality - 1)::int, value
      from jsonb_array_elements(v_wheel.slots) with ordinality
     order by ordinality
  loop
    v_acc := v_acc + greatest(coalesce((v_slot ->> 'weight')::numeric, 0), 0);
    if v_roll < v_acc then
      v_pick   := v_index;
      v_label  := coalesce(v_slot ->> 'label', '');
      v_payout := greatest(coalesce((v_slot ->> 'payout')::int, 0), 0);
      exit;
    end if;
  end loop;

  -- 끝자리 오차로 아무 칸도 못 고르는 경우 — 마지막 칸으로 떨어뜨린다
  if v_pick is null then
    v_pick   := jsonb_array_length(v_wheel.slots) - 1;
    v_slot   := v_wheel.slots -> v_pick;
    v_label  := coalesce(v_slot ->> 'label', '');
    v_payout := greatest(coalesce((v_slot ->> 'payout')::int, 0), 0);
  end if;

  v_points := v_sheet.points - v_wheel.entry_fee + v_payout;

  -- 창구가 하는 갱신임을 트리거에게 알린다 (이 트랜잭션에서만 유효하다)
  perform set_config('app.shop_trade', 'on', true);
  update public.sheets set points = v_points where id = v_sheet.id;
  perform set_config('app.shop_trade', 'off', true);

  insert into public.roulette_spins
    (wheel_id, wheel_name, account, spinner_name, slot_index, label, payout, fee, net, points)
  values
    (v_wheel.id, v_wheel.name, auth.uid(), v_sheet.name, v_pick, v_label,
     v_payout, v_wheel.entry_fee, v_payout - v_wheel.entry_fee, v_points);

  return query
    select v_points, v_pick, v_label, v_payout, v_wheel.entry_fee, v_payout - v_wheel.entry_fee;
end;
$fn$;

revoke all on function public.roulette_spin(uuid) from public, anon;
grant execute on function public.roulette_spin(uuid) to authenticated;

comment on function public.roulette_spin(uuid) is
  '룰렛을 한 번 돌린다. 참가비 · 칸 · 확률은 roulette_wheels 를 보고, 뽑기는 서버가 한다. 배치 중에는 닫힌다.';

-- ── 5 · 기본 원반 하나 ──────────────────────────────────
--  운영진이 작전실에서 고치거나 지우면 된다.
--  원반이 이미 하나라도 있으면 두지 않는다 — 다시 실행해도 늘어나지 않는다.
insert into public.roulette_wheels (name, description, entry_fee, slots, active, sort)
select
  '별자리 회전반',
  '관리국이 눈감아 주는 뒷골목 원반. 한 번에 하나씩만 돌린다.',
  50,
  jsonb_build_array(
    jsonb_build_object('label', '꽝',     'payout',    0, 'weight', 40),
    jsonb_build_object('label', '10 P',   'payout',   10, 'weight', 25),
    jsonb_build_object('label', '30 P',   'payout',   30, 'weight', 18),
    jsonb_build_object('label', '60 P',   'payout',   60, 'weight', 10),
    jsonb_build_object('label', '120 P',  'payout',  120, 'weight',  5),
    jsonb_build_object('label', '300 P',  'payout',  300, 'weight',  2),
    jsonb_build_object('label', '별자리', 'payout', 1000, 'weight',  1)
  ),
  true,
  0
where not exists (select 1 from public.roulette_wheels);
