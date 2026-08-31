-- ============================================================
--  공개 프로필에 시트 전문을 싣는다
--
--  0009 까지 적용한 뒤 SQL Editor 에 붙여 실행한다.
--
--  0009 의 public_profiles 는 스탯과 스킬 수치를 잘라 냈다.
--  참가자끼리 서로의 캐릭터를 읽는 것이 이 커뮤니티의 목적이므로,
--  **참가자가 제출한 시트 내용은 전부 공개**하는 쪽으로 바꾼다.
--
--  여전히 담지 않는 것 — 시트가 아니라 운영 정보다.
--    계정(auth.users) · 보유 포인트 · 보급품 · 전투 기록 · 전투 중 조정값
-- ============================================================

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
    -- 옛 시트는 concept 에만 글이 남아 있을 수 있다
    case when s.personality = '' then coalesce(s.concept, '') else s.personality end as personality,
    s.traits,
    s.contract_story,
    -- 제출한 그대로 — 스탯 배분값과 스킬(AP · 위력 · 쿨 · 부여 상태)
    coalesce(s.stats, '{}'::jsonb)  as stats,
    coalesce(s.skills, '[]'::jsonb) as skills
  from public.profiles p
  join public.sheets s on s.owner = p.id;

-- 로그인한 참가자만 읽는다. 비로그인 방문자에게는 열어 주지 않는다.
revoke all on public.public_profiles from anon;
grant select on public.public_profiles to authenticated;

comment on view public.public_profiles is
  '공개 프로필 — 참가자가 제출한 시트 내용 전부. 계정 · 포인트 · 전투 기록 같은 운영 정보는 담지 않는다.';
