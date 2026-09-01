-- ============================================================
--  편성을 명부에 공개한다
--
--  0019 까지 적용한 뒤 SQL Editor 에 붙여 실행한다.
--
--  누가 누구와 짝인지는 커뮤니티가 함께 읽는 정보다. 그런데 pair_bonds 는
--  `authenticated` 에게만 열려 있어서, 명부 게시판을 로그인 없이 열면 페어가 비었다.
--  이름과 라벨만 담은 뷰를 하나 두고 비로그인(anon)에게도 연다.
--
--  담지 않는 것 — 해산된 편성, 그리고 옛 공용 지갑 칸(points · inventory).
--  활동명(handle)은 담는다. 공개 시트 주소가 곧 활동명이라 이미 공개된 값이고,
--  이것이 없으면 페어 카드에서 각자의 시트로 넘어갈 수 없다.
-- ============================================================

create or replace view public.public_pairs
with (security_invoker = false) as
  select
    b.id,
    b.label,
    b.hunter_handle,
    b.constellation_handle,
    b.hunter_name,
    b.constellation_name,
    b.affiliation,
    b.created_at
  from public.pair_bonds b
  where b.active
  order by b.label;

grant select on public.public_pairs to anon, authenticated;

comment on view public.public_pairs is
  '공개 편성 — 활성 페어의 라벨 · 두 사람의 이름과 활동명. 비로그인(anon)도 읽는다. 해산된 편성과 옛 공용 지갑은 담지 않는다.';
