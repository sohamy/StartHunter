-- ============================================================
--  개인 지갑을 전투 안까지 · 선물하기 · 능력치 강화
--
--  0016 까지 적용한 뒤 SQL Editor 에 붙여 실행한다.
--
--  1) 전투 중에도 소지금과 가방은 사람마다 따로 굴러간다.
--     값은 battle_pairs.hunter · constellation (jsonb) 안으로 들어갔다 —
--     표 구조는 그대로이고, 옛 points · inventory 칸만 쓰지 않게 된다.
--
--  2) 선물하기 — 활동명으로 상대를 찾아 소지금이나 보급품을 넘긴다.
--
--  3) 능력치 강화 — 전투 밖에서 쓰는 보급품이 시트의 stat_bonus 를 올린다.
--     배분 점수(12점 · 상한 6)와 따로 세는 값이며, 상한은 운영진이 진열에서 정한다.
--
--  소지금 · 가방 · 강화는 모두 참가자가 직접 고칠 수 없다 — 트리거가 막고,
--  창구 함수(shop_trade · shop_gift · use_supply)만 지나갈 수 있다.
-- ============================================================

-- ── 1 · 강화로 오른 능력치 ──────────────────────────────
alter table public.sheets
  add column if not exists stat_bonus jsonb not null default '{}'::jsonb;

comment on column public.sheets.stat_bonus is
  '강화 보급품으로 영구히 오른 능력치. 배분 점수와 따로 센다 — 검증은 stats 만 본다.';

comment on column public.battle_pairs.points is
  '더 이상 쓰지 않는다 — 전투 중 소지금은 hunter · constellation jsonb 안에 있다.';
comment on column public.battle_pairs.inventory is
  '더 이상 쓰지 않는다 — 전투 중 가방은 hunter · constellation jsonb 안에 있다.';

-- ── 2 · 지갑 · 가방 · 강화는 창구를 거쳐야 바뀐다 ───────
create or replace function public.guard_sheet_wallet()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- 창구가 세운 표식 — shop_trade · shop_gift · use_supply 안에서만 켜진다 (트랜잭션 한정)
  if coalesce(current_setting('app.shop_trade', true), '') = 'on' then
    return new;
  end if;

  -- 운영진은 창구를 직접 여닫는다
  if public.is_operator() then
    return new;
  end if;

  if new.points is distinct from old.points then
    raise exception '소지금은 창구(상점 · 선물)를 거쳐야 바뀝니다.';
  end if;
  if new.inventory is distinct from old.inventory then
    raise exception '가방은 창구(상점 · 선물)를 거쳐야 바뀝니다.';
  end if;
  if new.stat_bonus is distinct from old.stat_bonus then
    raise exception '강화 능력치는 보급품을 써야 오릅니다.';
  end if;

  return new;
end;
$$;

-- ── 3 · 배치 여부는 한 곳에서 본다 ──────────────────────
create or replace function public.is_deployed(p_account uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1
      from public.battle_pairs bp
      join public.battles b on b.id = bp.battle_id
     where b.status not in ('CLEARED', 'FAILED')
       and p_account in (bp.hunter_account, bp.constellation_account)
  );
$$;

comment on function public.is_deployed(uuid) is
  '진행 중인 전투에 배치되어 있는지. 배치된 동안에는 상점 · 선물 · 강화 창구가 닫힌다.';

-- ── 4 · 선물하기 ────────────────────────────────────────
--  p_kind: 'POINTS' | 'ITEM'
--  받는 쪽의 보유 한도(shop_items.buy_limit)와 한 칸 최대치(9)를 넘겨 보낼 수 없다.
create or replace function public.shop_gift(
  p_handle  text,
  p_kind    text,
  p_item_id text,
  p_amount  int
)
returns table (points int, inventory jsonb, to_name text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_from      public.sheets%rowtype;
  v_to        public.sheets%rowtype;
  v_to_id     uuid;
  v_amount    int := coalesce(p_amount, 0);
  v_owned     int;
  v_has       int;
  v_ceiling   int;
  v_from_next jsonb;
  v_to_next   jsonb;
begin
  if p_kind not in ('POINTS', 'ITEM') then
    raise exception '알 수 없는 요청입니다.';
  end if;
  if v_amount < 1 then
    raise exception '1 이상을 보내세요.';
  end if;

  select * into v_from from public.sheets where owner = auth.uid();
  if not found then
    raise exception '등록된 시트가 없습니다.';
  end if;

  select id into v_to_id from public.profiles where lower(handle) = lower(btrim(p_handle));
  if v_to_id is null then
    raise exception '그런 활동명을 찾을 수 없습니다.';
  end if;
  if v_to_id = auth.uid() then
    raise exception '자기 자신에게는 보낼 수 없습니다.';
  end if;

  select * into v_to from public.sheets where owner = v_to_id;
  if not found then
    raise exception '받는 사람의 시트가 없습니다.';
  end if;

  if public.is_deployed(auth.uid()) then
    raise exception '전투에 배치된 동안에는 보낼 수 없습니다.';
  end if;
  if public.is_deployed(v_to_id) then
    raise exception '받는 사람이 전투에 배치되어 있습니다. 전투가 끝난 뒤에 보내세요.';
  end if;

  -- 창구가 하는 갱신임을 트리거에게 알린다 (이 트랜잭션에서만 유효하다)
  perform set_config('app.shop_trade', 'on', true);

  if p_kind = 'POINTS' then
    if v_from.points < v_amount then
      raise exception '소지금이 부족합니다. (보유 %P)', v_from.points;
    end if;

    -- 돌려주는 칸 이름(points)과 표의 칸 이름이 같다 — 값은 언제나 레코드로 짚는다
    update public.sheets set points = v_from.points - v_amount where id = v_from.id;
    update public.sheets set points = v_to.points   + v_amount where id = v_to.id;

    perform set_config('app.shop_trade', 'off', true);
    return query
      select v_from.points - v_amount, coalesce(v_from.inventory, '[]'::jsonb), v_to.name;
    return;
  end if;

  -- ── 보급품
  if p_item_id is null or p_item_id = '' then
    raise exception '보낼 품목을 고르세요.';
  end if;

  select coalesce(
           (select (value ->> 'quantity')::int
              from jsonb_array_elements(coalesce(v_from.inventory, '[]'::jsonb))
             where value ->> 'itemId' = p_item_id
             limit 1),
           0)
    into v_owned;

  if v_owned < v_amount then
    raise exception '보유 개수가 모자랍니다. (현재 %개)', v_owned;
  end if;

  select coalesce(
           (select (value ->> 'quantity')::int
              from jsonb_array_elements(coalesce(v_to.inventory, '[]'::jsonb))
             where value ->> 'itemId' = p_item_id
             limit 1),
           0)
    into v_has;

  -- 받는 쪽 한도 — 진열에 한도가 있으면 그것을, 없으면 한 칸 최대치를 쓴다
  select least(coalesce(buy_limit, 9), 9) into v_ceiling
    from public.shop_items where item_id = p_item_id;
  v_ceiling := coalesce(v_ceiling, 9);

  if v_has + v_amount > v_ceiling then
    raise exception '받는 쪽의 보유 한도를 넘습니다. (한도 %개 · 현재 %개)', v_ceiling, v_has;
  end if;

  -- 보내는 쪽 가방 — 0개가 되면 줄을 지운다
  select coalesce(jsonb_agg(entry), '[]'::jsonb) into v_from_next
    from (
      select value as entry
        from jsonb_array_elements(coalesce(v_from.inventory, '[]'::jsonb))
       where value ->> 'itemId' <> p_item_id
       union all
      select jsonb_build_object('itemId', p_item_id, 'quantity', v_owned - v_amount)
       where v_owned - v_amount > 0
    ) stacks;

  -- 받는 쪽 가방
  select coalesce(jsonb_agg(entry), '[]'::jsonb) into v_to_next
    from (
      select value as entry
        from jsonb_array_elements(coalesce(v_to.inventory, '[]'::jsonb))
       where value ->> 'itemId' <> p_item_id
       union all
      select jsonb_build_object('itemId', p_item_id, 'quantity', v_has + v_amount)
    ) stacks;

  update public.sheets set inventory = v_from_next where id = v_from.id;
  update public.sheets set inventory = v_to_next   where id = v_to.id;

  perform set_config('app.shop_trade', 'off', true);
  return query select v_from.points, v_from_next, v_to.name;
end;
$$;

revoke all on function public.shop_gift(text, text, text, int) from public, anon;
grant execute on function public.shop_gift(text, text, text, int) to authenticated;

comment on function public.shop_gift(text, text, text, int) is
  '선물하기. 활동명으로 상대를 찾아 소지금이나 보급품을 넘긴다. 배치 중에는 닫힌다.';

-- ── 5 · 강화 보급품 사용 ────────────────────────────────
--  올릴 능력치와 상한은 진열(shop_items.item -> effect)에 적힌 값을 쓴다.
--  코드에만 있는 품목은 서버가 정의를 모르므로 아래 6 절에서 함께 심는다.
create or replace function public.use_supply(p_item_id text)
returns table (stat_bonus jsonb, inventory jsonb)
language plpgsql
security definer set search_path = public
as $$
declare
  v_sheet    public.sheets%rowtype;
  v_def      jsonb;
  v_gain     jsonb;
  v_cap      int;
  v_owned    int;
  v_bonus    jsonb;
  v_next     jsonb;
  v_key      text;
  v_amount   int;
  v_now      int;
  v_category text;
begin
  select * into v_sheet from public.sheets where owner = auth.uid();
  if not found then
    raise exception '등록된 시트가 없습니다.';
  end if;

  if public.is_deployed(auth.uid()) then
    raise exception '전투에 배치된 동안에는 쓸 수 없습니다.';
  end if;

  select item into v_def from public.shop_items where item_id = p_item_id;
  if v_def is null then
    raise exception '여기서 쓸 수 있는 품목이 아닙니다.';
  end if;

  v_gain := v_def -> 'effect' -> 'statGain';
  if v_gain is null or jsonb_typeof(v_gain) <> 'object' then
    raise exception '여기서 쓸 수 있는 품목이 아닙니다.';
  end if;
  if coalesce((v_def ->> 'combatUsable')::boolean, false) then
    raise exception '전투에서 쓰는 품목입니다.';
  end if;

  v_category := v_def ->> 'category';
  if v_category = 'HUNTER_ONLY' and v_sheet.side <> 'HUNTER' then
    raise exception '이 주체가 쓸 수 없는 분류입니다.';
  end if;
  if v_category = 'CONSTELLATION_ONLY' and v_sheet.side <> 'CONSTELLATION' then
    raise exception '이 주체가 쓸 수 없는 분류입니다.';
  end if;

  select coalesce(
           (select (value ->> 'quantity')::int
              from jsonb_array_elements(coalesce(v_sheet.inventory, '[]'::jsonb))
             where value ->> 'itemId' = p_item_id
             limit 1),
           0)
    into v_owned;

  if v_owned <= 0 then
    raise exception '보유하고 있지 않습니다.';
  end if;

  v_cap := (v_def -> 'effect' ->> 'statCap')::int;
  v_bonus := coalesce(v_sheet.stat_bonus, '{}'::jsonb);

  for v_key, v_amount in select key, value::int from jsonb_each_text(v_gain) loop
    if v_amount <= 0 then
      continue;
    end if;
    v_now := coalesce((v_bonus ->> v_key)::int, 0);
    if v_cap is not null and v_now + v_amount > v_cap then
      raise exception '강화 상한을 넘습니다. (상한 +% · 지금 +%)', v_cap, v_now;
    end if;
    v_bonus := jsonb_set(v_bonus, array[v_key], to_jsonb(v_now + v_amount), true);
  end loop;

  select coalesce(jsonb_agg(entry), '[]'::jsonb) into v_next
    from (
      select value as entry
        from jsonb_array_elements(coalesce(v_sheet.inventory, '[]'::jsonb))
       where value ->> 'itemId' <> p_item_id
       union all
      select jsonb_build_object('itemId', p_item_id, 'quantity', v_owned - 1)
       where v_owned - 1 > 0
    ) stacks;

  perform set_config('app.shop_trade', 'on', true);
  update public.sheets set stat_bonus = v_bonus, inventory = v_next where id = v_sheet.id;
  perform set_config('app.shop_trade', 'off', true);

  return query select v_bonus, v_next;
end;
$$;

revoke all on function public.use_supply(text) from public, anon;
grant execute on function public.use_supply(text) to authenticated;

comment on function public.use_supply(text) is
  '강화 보급품 사용. 올릴 능력치와 상한은 진열에 적힌 정의를 따른다. 배치 중에는 닫힌다.';

-- ── 6 · 새 품목을 진열에 심는다 ─────────────────────────
--  강화 품목은 서버가 판정하므로 정의(item)까지 함께 둔다.
--  코드(src/battle/config/items.ts)에 같은 값이 있고, 여기 있는 것이 우선한다.
--  값을 고칠 때는 작전실 진열에서 고치면 된다.
insert into public.shop_items (item_id, price, buy_limit, active, sort, item)
values
  ('item.stim', 90, 3, true, 10, jsonb_build_object(
     'id', 'item.stim', 'name', 'COMBAT STIM', 'nameKo', '전투 각성제',
     'category', 'HUNTER_ONLY', 'description', '한 판만 몸을 끌어올린다. 끝나면 그대로 가라앉는다.',
     'target', 'SELF', 'apCost', 1, 'combatUsable', true,
     'effect', jsonb_build_object('applyStatusIds', jsonb_build_array('stat.surge')))),

  ('item.train.str', 400, 2, true, 11, jsonb_build_object(
     'id', 'item.train.str', 'name', 'STRENGTH CORE', 'nameKo', '근력 단련석',
     'category', 'HUNTER_ONLY', 'description', '삼키면 근육이 다시 짜인다. 몸에 남는다.',
     'target', 'SELF', 'apCost', 0, 'combatUsable', false,
     'effect', jsonb_build_object('statGain', jsonb_build_object('str', 1), 'statCap', 3))),

  ('item.train.vit', 400, 2, true, 12, jsonb_build_object(
     'id', 'item.train.vit', 'name', 'VITALITY CORE', 'nameKo', '체력 강화제',
     'category', 'HUNTER_ONLY', 'description', '버티는 몸을 만든다. 몸에 남는다.',
     'target', 'SELF', 'apCost', 0, 'combatUsable', false,
     'effect', jsonb_build_object('statGain', jsonb_build_object('vit', 1), 'statCap', 3))),

  ('item.train.agi', 400, 2, true, 13, jsonb_build_object(
     'id', 'item.train.agi', 'name', 'AGILITY CORE', 'nameKo', '민첩 촉진제',
     'category', 'HUNTER_ONLY', 'description', '반응이 한 박자 빨라진다. 몸에 남는다.',
     'target', 'SELF', 'apCost', 0, 'combatUsable', false,
     'effect', jsonb_build_object('statGain', jsonb_build_object('agi', 1), 'statCap', 3))),

  ('item.train.authority', 400, 2, true, 14, jsonb_build_object(
     'id', 'item.train.authority', 'name', 'AUTHORITY CRYSTAL', 'nameKo', '권능 응결정',
     'category', 'CONSTELLATION_ONLY', 'description', '성유물. 흩어진 권능을 한 겹 더 굳힌다.',
     'target', 'SELF', 'apCost', 0, 'combatUsable', false,
     'effect', jsonb_build_object('statGain', jsonb_build_object('authority', 1), 'statCap', 3))),

  ('item.train.divinity', 400, 2, true, 15, jsonb_build_object(
     'id', 'item.train.divinity', 'name', 'DIVINITY SHARD', 'nameKo', '신격의 편린',
     'category', 'CONSTELLATION_ONLY', 'description', '성유물. 격이 한 뼘 올라간다.',
     'target', 'SELF', 'apCost', 0, 'combatUsable', false,
     'effect', jsonb_build_object('statGain', jsonb_build_object('divinity', 1), 'statCap', 3)))
on conflict (item_id) do nothing;

-- ── 7 · 공개 프로필에 강화분을 싣는다 ───────────────────
drop view if exists public.public_profiles;

create view public.public_profiles
with (security_invoker = false) as
  select
    p.id            as account_id,
    p.handle,
    s.side,
    s.name,
    s.pair_name,
    s.partner_name,
    s.class_id,
    s.affiliation,
    s.portrait,
    case when s.personality = '' then coalesce(s.concept, '') else s.personality end as personality,
    s.traits,
    s.contract_story,
    coalesce(s.stats, '{}'::jsonb)      as stats,
    coalesce(s.stat_bonus, '{}'::jsonb) as stat_bonus,
    coalesce(s.skills, '[]'::jsonb)     as skills,
    coalesce(s.points, 0)               as points,
    coalesce(s.inventory, '[]'::jsonb)  as inventory
  from public.profiles p
  join public.sheets s on s.owner = p.id;

-- 0014 에서 연 것을 그대로 유지한다 — 링크를 받은 사람은 로그인 없이 읽는다
grant select on public.public_profiles to anon, authenticated;

comment on view public.public_profiles is
  '공개 프로필 — 참가자가 제출한 시트 내용 전부와 개인 소지금 · 가방 · 강화. 비로그인(anon)도 읽는다. 계정 정보와 전투 기록은 담지 않는다.';
