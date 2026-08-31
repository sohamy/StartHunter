-- ============================================================
--  페어명 — 참가자가 직접 적는다
--
--  0012 까지 적용한 뒤 SQL Editor 에 붙여 실행한다.
--
--  같은 페어명을 적은 사람끼리 관리국이 짝을 짓는다.
--  편성이 확정되면 그 이름이 편성 라벨(pair_bonds.label)이 된다.
-- ============================================================

alter table public.sheets
  add column if not exists pair_name text not null default '';

comment on column public.sheets.pair_name is
  '참가자가 적어 낸 페어 이름. 공란 가능 — 관리국이 이 이름으로 짝을 짓는다.';

-- ── 공개 프로필에 싣는다 ────────────────────────────────
--  운영진 화면이 페어명으로 후보를 묶으려면 목록에서 바로 보여야 한다.
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
