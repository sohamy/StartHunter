-- ============================================================
--  캐릭터 사진
--
--  0001~0006 를 적용한 뒤 SQL Editor 에 붙여 실행한다.
--
--  파일 저장소(Storage 버킷)를 따로 두지 않는다.
--  브라우저에서 정사각 320px JPEG 으로 줄여 구운 data URL 을 그대로 담는다.
--  대략 한 장에 40~90KB 이며, 상한은 config/rules.ts 의 PORTRAIT_RULES 가 정한다.
-- ============================================================

alter table public.sheets
  add column if not exists portrait text;

comment on column public.sheets.portrait is
  '캐릭터 사진. data:image/jpeg;base64,... 형태의 정사각 축소본. 없으면 null.';

-- 시트 전문을 못 보는 참가자도 서로의 얼굴은 볼 수 있어야 한다.
-- 뷰는 열을 덧붙이는 방향으로만 바꾼다 (순서 변경 · 삭제는 replace 가 거부한다).
create or replace view public.public_profiles
with (security_invoker = true) as
  select p.id as account_id, p.handle, s.side, s.name, s.class_id, s.portrait
  from public.profiles p
  join public.sheets s on s.owner = p.id;
