-- ============================================================
--  소지금과 가방을 개인 소유로
--
--  0011 까지 적용한 뒤 SQL Editor 에 붙여 실행한다.
--
--  포인트와 보급품은 편성(pair_bonds)이 아니라 **사람**에게 붙는다.
--  두 사람이 지갑을 나눠 쓰지 않는다 — 각자 벌고, 각자 산다.
--
--  전투는 두 사람의 가방을 합쳐 한 판을 돌고, 정산에서 쓴 만큼 각자에게서 뺀다.
--  얻은 포인트는 나누지 않고 두 사람 모두에게 준다.
-- ============================================================

alter table public.sheets
  add column if not exists points    int   not null default 0 check (points >= 0),
  add column if not exists inventory jsonb not null default '[]'::jsonb;

comment on column public.sheets.points is
  '소지금. 개인 소유 — 페어와 나누지 않는다. 지급 · 차감은 관리국이 한다.';
comment on column public.sheets.inventory is
  '개인 가방(ItemStack[]). 전투에 들어갈 때 페어의 가방으로 합쳐진다.';

-- 편성이 들고 있던 값을 두 사람에게 옮긴다.
-- 포인트는 나누지 않고 각자에게 그대로 준다 — 같이 벌었으므로 같이 받는다.
-- 여러 번 실행해도 안전하도록, 아직 0 인 시트에만 옮긴다.
update public.sheets s
   set points = coalesce(b.points, 0)
  from public.pair_bonds b
  join public.profiles p
    on p.handle in (b.hunter_handle, b.constellation_handle)
 where s.owner = p.id
   and s.points = 0
   and coalesce(b.points, 0) > 0;

update public.sheets s
   set inventory = coalesce(b.inventory, '[]'::jsonb)
  from public.pair_bonds b
  join public.profiles p
    on p.handle in (b.hunter_handle, b.constellation_handle)
 where s.owner = p.id
   and s.inventory = '[]'::jsonb
   and coalesce(b.inventory, '[]'::jsonb) <> '[]'::jsonb;

comment on column public.pair_bonds.points is
  '더 이상 쓰지 않는다 — 소지금은 sheets.points 로 옮겼다. 옛 자료를 위해 남겨 둔다.';
comment on column public.pair_bonds.inventory is
  '더 이상 쓰지 않는다 — 가방은 sheets.inventory 로 옮겼다. 옛 자료를 위해 남겨 둔다.';

-- ── 공개 프로필에도 싣는다 ──────────────────────────────
--  시트에 있는 것은 전부 공개한다는 원칙(0010)을 그대로 따른다.
drop view if exists public.public_profiles;

create view public.public_profiles
with (security_invoker = false) as
  select
    p.id            as account_id,
    p.handle,
    s.side,
    s.name,
    s.partner_name,
    s.class_id,
    s.affiliation,
    s.portrait,
    case when s.personality = '' then coalesce(s.concept, '') else s.personality end as personality,
    s.traits,
    s.contract_story,
    coalesce(s.stats, '{}'::jsonb)     as stats,
    coalesce(s.skills, '[]'::jsonb)    as skills,
    coalesce(s.points, 0)              as points,
    coalesce(s.inventory, '[]'::jsonb) as inventory
  from public.profiles p
  join public.sheets s on s.owner = p.id;

revoke all on public.public_profiles from anon;
grant select on public.public_profiles to authenticated;

comment on view public.public_profiles is
  '공개 프로필 — 참가자가 제출한 시트 내용 전부와 개인 소지금 · 가방. 계정 정보와 전투 기록은 담지 않는다.';
