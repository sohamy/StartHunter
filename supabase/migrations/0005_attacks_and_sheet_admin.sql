-- ============================================================
--  커스텀 공격 패턴 · 운영진 시트 관리
--
--  0001~0004 를 적용한 뒤 SQL Editor 에 붙여 실행한다.
--
--  1. 운영진이 적의 공격을 직접 만들어 페이즈별로 붙인다.
--     (공격 목록이 하나라도 있으면 프리셋 패턴 세트는 쓰지 않는다)
--  2. 운영진이 참가자 시트를 삭제할 수 있게 한다.
--     계정(auth.users)은 남는다 — 계정 삭제는 대시보드에서 처리한다.
-- ============================================================

-- ── 적 공격 패턴 ────────────────────────────────────────
alter table public.enemy_templates
  add column if not exists attacks jsonb not null default '[]'::jsonb;

comment on column public.enemy_templates.attacks is
  '운영진이 만든 공격 목록. 각 항목은 이름 · 연출 · 계수 · 광역 · 상태이상 · 예고 · 사용 페이즈를 가진다.';

-- 전투에 배치된 적(battles.enemies)은 이미 jsonb 이므로 스키마 변경이 필요 없다.

-- ── 시트 삭제 ───────────────────────────────────────────
-- 지금까지 sheets 에는 delete 정책이 없어 누구도 지울 수 없었다.
drop policy if exists "sheets delete own or operator" on public.sheets;
create policy "sheets delete own or operator" on public.sheets
  for delete to authenticated using (owner = auth.uid() or public.is_operator());
