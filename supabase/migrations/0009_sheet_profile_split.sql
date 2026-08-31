-- ============================================================
--  컨셉 분할 · 계약 상대 · 공개 시트 경계
--
--  0001~0008 을 적용한 뒤 SQL Editor 에 붙여 실행한다.
--
--  1) 한 칸짜리 concept 을 성격 / 특징 / 계약 경위 세 칸으로 나눈다.
--     기존에 적힌 글은 성격 칸으로 옮긴다 (지우지 않는다).
--  2) 참가자가 직접 적는 계약 상대 이름 칸을 만든다. 공란이어도 된다.
--  3) public_profiles 뷰를 공개 시트의 경계로 삼는다.
--     화면 코드를 어떻게 고치든 스탯과 스킬 수치는 이 뷰를 통과하지 못한다.
-- ============================================================

-- ── 1 · 컨셉 세 칸과 계약 상대 ──────────────────────────
alter table public.sheets
  add column if not exists partner_name   text not null default '',
  add column if not exists personality    text not null default '',
  add column if not exists traits         text not null default '',
  add column if not exists contract_story text not null default '';

comment on column public.sheets.partner_name is
  '참가자가 적어 둔 계약 상대(페어) 이름. 공란 가능 — 편성이 확정되면 pair_bonds 쪽이 우선한다.';
comment on column public.sheets.personality is '성격.';
comment on column public.sheets.traits is '특징 — 좋아하는 것 · 싫어하는 것 · 생일 등.';
comment on column public.sheets.contract_story is '성좌와 계약을 맺은 경위. 공란 가능.';

-- 예전에 한 칸에 적어 둔 글은 성격 칸으로 옮긴다. 여러 번 실행해도 안전하다.
update public.sheets
   set personality = concept
 where personality = ''
   and coalesce(concept, '') <> '';

comment on column public.sheets.concept is
  '0009 이전에 쓰던 한 칸짜리 서술. 더 이상 기록하지 않는다 — 옛 시트를 열기 위해 남겨 둔다.';

-- ── 2 · 공개 시트 ───────────────────────────────────────
--  sheets 의 RLS 는 "본인 또는 운영진"이라 참가자는 남의 시트를 못 읽는다.
--  그래서 뷰를 security_invoker = false(정의자 권한)로 두고, 공개해도 되는 열만 담는다.
--  · 공개  — 사진 · 이름 · 쪽 · 클래스 · 소속 · 계약 상대 · 성격 · 특징 · 계약 경위 · 스킬 이름
--  · 비공개 — 스탯, 환산 전투 수치, 스킬의 AP · 위력 · 쿨 · 부여 상태
--  열 구성이 바뀌므로 replace 가 아니라 drop 후 재생성한다.
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
    -- 스킬은 이름 · 종류 · 설명까지만. 수치는 여기서 잘린다.
    coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'id',          row_skill ->> 'id',
                   'name',        row_skill ->> 'name',
                   'kind',        row_skill ->> 'kind',
                   'description', coalesce(row_skill ->> 'description', '')
                 )
               )
          from jsonb_array_elements(coalesce(s.skills, '[]'::jsonb)) as row_skill
      ),
      '[]'::jsonb
    ) as public_skills
  from public.profiles p
  join public.sheets s on s.owner = p.id;

-- 로그인한 참가자만 읽는다. 비로그인 방문자에게는 열어 주지 않는다.
revoke all on public.public_profiles from anon;
grant select on public.public_profiles to authenticated;

comment on view public.public_profiles is
  '공개 시트 — 참가자끼리 보이는 범위. 스탯과 스킬 수치는 담기지 않는다. 전체 인원을 카드로 늘어놓는 화면은 운영진 작전실에만 있다.';
