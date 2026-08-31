-- ============================================================
--  상점을 거친 갱신은 트리거가 보내 준다
--
--  0015 를 적용한 뒤 이어서 실행한다.
--
--  0015 의 트리거는 shop_trade() 가 스스로 실행하는 UPDATE 까지 막았다.
--  security definer 는 권한만 바꿀 뿐, 트리거를 건너뛰게 하지 않는다.
--  그래서 정상 구매도 "소지금은 상점(shop_trade)을 거쳐야 바뀝니다" 로 거절됐다.
--
--  상점이 트랜잭션 안에서만 켜지는 표식을 세우고, 트리거가 그것을 보고 통과시킨다.
--  표식은 트랜잭션이 끝나면 사라지므로 밖에서 흉내 낼 수 없다.
-- ============================================================

create or replace function public.guard_sheet_wallet()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- 상점이 세운 표식 — shop_trade() 안에서만 켜진다 (트랜잭션 한정)
  if coalesce(current_setting('app.shop_trade', true), '') = 'on' then
    return new;
  end if;

  -- 운영진은 창구를 직접 여닫는다
  if public.is_operator() then
    return new;
  end if;

  if new.points is distinct from old.points then
    raise exception '소지금은 상점(shop_trade)을 거쳐야 바뀝니다.';
  end if;
  if new.inventory is distinct from old.inventory then
    raise exception '가방은 상점(shop_trade)을 거쳐야 바뀝니다.';
  end if;

  return new;
end;
$$;

create or replace function public.shop_trade(p_item_id text, p_kind text)
returns table (points int, inventory jsonb)
language plpgsql
security definer set search_path = public
as $$
declare
  v_sheet     public.sheets%rowtype;
  v_entry     public.shop_items%rowtype;
  v_owned     int;
  v_next      jsonb;
  v_points    int;
  v_deployed  boolean;
begin
  if p_kind not in ('BUY', 'SELL') then
    raise exception '알 수 없는 요청입니다.';
  end if;

  select * into v_sheet from public.sheets where owner = auth.uid();
  if not found then
    raise exception '등록된 시트가 없습니다.';
  end if;

  -- 진행 중인 전투에 배치돼 있으면 창구를 닫는다
  select exists (
    select 1
      from public.battle_pairs bp
      join public.battles b on b.id = bp.battle_id
     where b.status not in ('CLEARED', 'FAILED')
       and auth.uid() in (bp.hunter_account, bp.constellation_account)
  ) into v_deployed;

  if v_deployed then
    raise exception '전투에 배치된 동안에는 보급을 사고팔 수 없습니다.';
  end if;

  select * into v_entry from public.shop_items where item_id = p_item_id and active;
  if not found then
    raise exception '취급하지 않는 품목입니다.';
  end if;

  -- 지금 몇 개 들고 있나
  select coalesce(
           (select (value ->> 'quantity')::int
              from jsonb_array_elements(coalesce(v_sheet.inventory, '[]'::jsonb))
             where value ->> 'itemId' = p_item_id
             limit 1),
           0)
    into v_owned;

  if p_kind = 'BUY' then
    if v_entry.buy_limit is not null and v_owned + 1 > v_entry.buy_limit then
      raise exception '보유 한도를 넘습니다. (한도 %개 · 현재 %개)', v_entry.buy_limit, v_owned;
    end if;
    if v_sheet.points < v_entry.price then
      raise exception '소지금이 부족합니다. (필요 %P · 보유 %P)', v_entry.price, v_sheet.points;
    end if;
    v_points := v_sheet.points - v_entry.price;
    v_owned  := v_owned + 1;
  else
    if v_owned <= 0 then
      raise exception '보유하고 있지 않습니다.';
    end if;
    v_points := v_sheet.points + floor(v_entry.price * 0.5)::int;
    v_owned  := v_owned - 1;
  end if;

  -- 가방 다시 쓰기 — 0개가 되면 줄을 지운다
  select coalesce(jsonb_agg(entry), '[]'::jsonb)
    into v_next
    from (
      select value as entry
        from jsonb_array_elements(coalesce(v_sheet.inventory, '[]'::jsonb))
       where value ->> 'itemId' <> p_item_id
       union all
      select jsonb_build_object('itemId', p_item_id, 'quantity', v_owned)
       where v_owned > 0
    ) stacks;

  -- 트리거에게 "이 갱신은 상점이 한 것" 이라고 알린다.
  -- 세 번째 인자 true = 이 트랜잭션에서만 유효하다.
  perform set_config('app.shop_trade', 'on', true);

  update public.sheets
     set points = v_points, inventory = v_next
   where id = v_sheet.id;

  perform set_config('app.shop_trade', 'off', true);

  return query select v_points, v_next;
end;
$$;

revoke all on function public.shop_trade(text, text) from public, anon;
grant execute on function public.shop_trade(text, text) to authenticated;
