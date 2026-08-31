-- ============================================================
--  상점 진열 — 운영진이 직접 넣는다
--
--  0010 까지 적용한 뒤 SQL Editor 에 붙여 실행한다.
--
--  기본 품목은 코드(config/items.ts · config/shop.ts)에 남는다.
--  이 표는 그 위에 얹는 층이다.
--    · 같은 item_id 면 가격 · 한도를 덮어쓴다
--    · active 가 false 면 진열에서 빠진다
--    · 기본 목록에 없는 item_id 면 새 품목으로 붙는다 (item 에 정의를 담는다)
--
--  진열은 참가자도 읽는다 (가격표). 넣고 고치는 것은 운영진만 한다.
-- ============================================================

create table if not exists public.shop_items (
  item_id     text primary key,
  price       int  not null default 0 check (price >= 0),
  -- limit 은 예약어라 컬럼명을 buy_limit 으로 둔다
  buy_limit   int,
  active      boolean not null default true,
  sort        int  not null default 0,
  -- 운영진이 새로 만든 품목의 정의(ItemDefinition). 기본 품목의 값만 고쳤으면 null.
  item        jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.shop_items is
  '상점 진열. 코드의 기본 목록 위에 얹는다 — 가격 · 한도 덮어쓰기, 진열 제외, 새 품목 추가.';
comment on column public.shop_items.buy_limit is
  '한 페어가 보유할 수 있는 최대 개수. null 이면 제한 없음.';
comment on column public.shop_items.item is
  '새로 만든 품목의 정의(ItemDefinition). 기본 품목이면 null — 정의는 코드 쪽을 쓴다.';

alter table public.shop_items enable row level security;

-- 가격표는 참가자도 본다
drop policy if exists "shop readable" on public.shop_items;
create policy "shop readable" on public.shop_items
  for select to authenticated using (true);

-- 넣고 고치고 지우는 것은 운영진만
drop policy if exists "shop operator write" on public.shop_items;
create policy "shop operator write" on public.shop_items
  for all to authenticated using (public.is_operator()) with check (public.is_operator());
