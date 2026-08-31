-- ============================================================
--  보스 패턴 설정 — 페이즈 경계
--
--  0001~0007 를 적용한 뒤 SQL Editor 에 붙여 실행한다.
--
--  지금까지 페이즈가 넘어가는 HP 지점은 코드(config/patterns.ts 의 프리셋)에만
--  있었고, 운영진이 만든 적은 페이즈 수만큼 HP 를 균등 분할할 수밖에 없었다.
--  이제 층마다 경계를 직접 정한다.
--
--  공격 자체의 발동 조건(라운드 주기 · HP 조건)은 이미 jsonb 인
--  enemy_templates.attacks 안에 들어가므로 스키마 변경이 필요 없다.
--  전투에 배치된 적(battles.enemies)도 jsonb 이라 그대로 따라온다.
-- ============================================================

alter table public.enemy_templates
  add column if not exists phase_cutoffs jsonb not null default '[]'::jsonb;

comment on column public.enemy_templates.phase_cutoffs is
  '페이즈가 넘어가는 HP 비율(%) 경계. 내림차순 숫자 배열이며 길이는 페이즈 수 - 1.
   [70, 30] 이면 HP 70% 이상 PHASE 1, 30% 이상 PHASE 2, 그 아래 PHASE 3.
   빈 배열이면 프리셋 패턴 세트의 경계를 쓰고, 그것도 없으면 균등 분할한다.';
