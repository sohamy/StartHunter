-- ============================================================
--  구매를 서버로 옮긴다
--
--  0014 까지 적용한 뒤 SQL Editor 에 붙여 실행한다.
--
--  지금까지 구매는 브라우저가 계산하고 시트를 통째로 저장했다.
--  본인 시트는 본인이 고칠 수 있으므로, 마음먹으면 소지금을 직접 올릴 수 있었다.
--
--  세 가지로 막는다.
--    1) 진열(가격 · 한도)을 서버에 둔다 — 기본 목록을 shop_items 에 심는다
--    2) 소지금 · 가방은 트리거가 지킨다 — 참가자가 직접 고치면 거절한다
--    3) 구매 · 반납은 shop_trade() 함수로만 한다 — 값도 규칙도 서버가 정한다
-- ============================================================

-- ── 1 · 기본 진열을 서버에 심는다 ───────────────────────
--  코드(config/shop.ts)의 기본 목록과 같은 값이다.
--  이미 운영진이 손댄 줄은 건드리지 않는다.
insert into public.shop_items (item_id, price, buy_limit, active, sort)
values
  ('item.medkit',             80, 5, true, 0),
  ('item.antidote',           60, 5, true, 1),
  ('item.smoke',              70, 4, true, 2),
  ('item.starfruit',         120, 3, true, 3),
  ('item.grenade',           180, 3, true, 4),
  ('item.lifeline',          260, 2, true, 5),
  ('item.censer',            150, 3, true, 6),
  ('item.anchor',            320, 1, true, 7),
  ('item.badge.government',  200, 2, true, 8),
  ('item.charm.guild',       200, 2, true, 9)
on conflict (item_id) do nothing;

-- ── 2 · 소지금과 가방은 참가자가 직접 못 고친다 ─────────
create or replace function public.guard_sheet_wallet()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
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

drop trigger if exists sheets_guard_wallet on public.sheets;
create trigger sheets_guard_wallet
  before update on public.sheets
  for each row execute function public.guard_sheet_wallet();

-- ── 3 · 구매 · 반납 ─────────────────────────────────────
--  kind: 'BUY' | 'SELL'. 반납은 구매가의 절반(내림)을 돌려준다.
--  security definer 로 돌아 트리거를 지나가지만, 판정은 모두 이 안에서 한다.
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

  update public.sheets
     set points = v_points, inventory = v_next
   where id = v_sheet.id;

  return query select v_points, v_next;
end;
$$;

revoke all on function public.shop_trade(text, text) from public, anon;
grant execute on function public.shop_trade(text, text) to authenticated;

comment on function public.shop_trade(text, text) is
  '보급 구매 · 반납. 가격과 한도는 shop_items 를, 배치 여부는 battle_pairs 를 본다. 참가자가 소지금을 직접 고치는 길은 트리거가 막는다.';
