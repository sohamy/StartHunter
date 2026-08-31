-- ============================================================
--  이름을 유니크 키로 · 선물은 이름으로 보낸다
--
--  0017 까지 적용한 뒤 SQL Editor 에 붙여 실행한다.
--
--  선물할 때 활동명(로그인 id)을 적게 하면, 상대의 로그인 id 를 알아야 한다.
--  참가자끼리 서로 부르는 이름은 캐릭터 이름이므로 그쪽으로 바꾼다.
--
--  이름으로 사람을 찾으려면 이름이 겹치지 않아야 한다 —
--  그래서 이름에 유니크 키를 건다. 대소문자와 앞뒤 공백은 같은 이름으로 본다
--  (lower(btrim(name)) 에 거는 유니크 색인).
--
--  색인과 조회는 **같은 식**을 쓴다. 색인만 lower(name) 으로 두면
--  '서리매듭' 과 ' 서리매듭 ' 이 나란히 등록되고, 그중 하나는 영영 찾을 수 없게 된다.
--
--  겹치는 이름이 남아 있으면 이 스크립트는 **아무것도 바꾸지 않고 멈춘다.**
--  누가 겹치는지 알려 주므로, 작전실에서 한쪽 이름을 고친 뒤 다시 실행하면 된다.
-- ============================================================

-- ── 1 · 앞뒤 공백을 떼어 낸다 ───────────────────────────
--  '알파' 와 '알파 ' 가 다른 이름으로 남아 있으면 찾을 때 갈린다.
update public.sheets set name = btrim(name) where name <> btrim(name);

-- ── 2 · 겹치는 이름이 있으면 먼저 알린다 ────────────────
do $$
declare
  v_dups text;
begin
  select string_agg(format('%s (%s장)', sample, cnt), ', ' order by sample)
    into v_dups
    from (
      select min(name) as sample, count(*) as cnt
        from public.sheets
       group by lower(btrim(name))
      having count(*) > 1
    ) d;

  if v_dups is not null then
    raise exception
      '이름이 겹치는 시트가 있어 유니크 키를 걸 수 없습니다 — 작전실에서 한쪽 이름을 고친 뒤 다시 실행하세요: %',
      v_dups;
  end if;
end $$;

-- ── 3 · 이름은 하나뿐이다 ───────────────────────────────
create unique index if not exists sheets_name_unique
  on public.sheets (lower(btrim(name)));

comment on column public.sheets.name is
  '헌터의 이름 또는 성좌의 성호. 참가자끼리 서로를 부르는 이름이라 겹칠 수 없다 — lower(btrim(name)) 에 유니크.';

-- ── 4 · 이름으로 상대를 찾는다 ──────────────────────────
--  선물 화면이 "누구에게 보내는지" 를 미리 보여 주는 데 쓴다.
--  시트 전문을 내려보내지 않고 이름과 쪽만 준다.
create or replace function public.find_by_name(p_name text)
returns table (name text, side text)
language sql
stable
security definer set search_path = public
as $$
  select s.name, s.side
    from public.sheets s
   where lower(btrim(s.name)) = lower(btrim(p_name))
   limit 1;
$$;

revoke all on function public.find_by_name(text) from public, anon;
grant execute on function public.find_by_name(text) to authenticated;

comment on function public.find_by_name(text) is
  '이름으로 참가자를 찾는다. 선물 화면이 받는 사람을 미리 보여 주는 데 쓴다 — 이름과 쪽만 준다.';

-- ── 5 · 선물은 이름으로 보낸다 ──────────────────────────
--  받는 칸의 이름이 p_handle → p_name 으로 바뀐다.
--  인자 이름은 create or replace 로 못 바꾸므로 먼저 지운다.
drop function if exists public.shop_gift(text, text, text, int);

create or replace function public.shop_gift(
  p_name    text,
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

  -- 이름은 유니크하므로 한 사람만 걸린다 (3 절의 색인과 같은 규칙으로 찾는다)
  select * into v_to from public.sheets where lower(btrim(name)) = lower(btrim(p_name));
  if not found then
    raise exception '그런 이름의 참가자를 찾을 수 없습니다.';
  end if;
  if v_to.owner = auth.uid() then
    raise exception '자기 자신에게는 보낼 수 없습니다.';
  end if;

  if public.is_deployed(auth.uid()) then
    raise exception '전투에 배치된 동안에는 보낼 수 없습니다.';
  end if;
  if public.is_deployed(v_to.owner) then
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
  '선물하기. 이름으로 상대를 찾아 소지금이나 보급품을 넘긴다. 배치 중에는 닫힌다.';
