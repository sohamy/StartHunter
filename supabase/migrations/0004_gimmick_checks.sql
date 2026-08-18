-- ============================================================
--  기믹 파악/해결 판정
--
--  0001~0003 을 적용한 뒤 실행한다.
--
--  기믹은 두 단계다. 참가자는 어떻게 하는지 직접 서술해야 하고(gimmick_note),
--  그 선언과 판정 결과(gimmick_check)는 채팅에 공개된다.
--  최종 인정 여부는 관리국이 정한다.
-- ============================================================

alter table public.submissions
  add column if not exists gimmick_note  text,
  add column if not exists gimmick_stage text check (gimmick_stage in ('INSIGHT', 'RESOLVE')),
  add column if not exists gimmick_check jsonb;

comment on column public.submissions.gimmick_note is
  '기믹 수행 선언 — 없으면 진행으로 인정되지 않는다';
comment on column public.submissions.gimmick_check is
  '확정 시점에 굴린 판정 기록 (주사위 · 스탯 보정 · 목표치 · 성공 여부)';

-- 헌터 쪽 제출 보호 트리거에 기믹 칼럼을 포함한다.
-- 기믹 수행은 헌터의 행동이므로 성좌 참가자는 건드릴 수 없다.
create or replace function public.enforce_submission_side()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  is_hunter boolean;
  is_constellation boolean;
begin
  if public.is_operator() then
    return new;
  end if;

  select bp.hunter_account = auth.uid(), bp.constellation_account = auth.uid()
    into is_hunter, is_constellation
  from public.battle_pairs bp
  where bp.id = new.pair_id;

  if coalesce(is_hunter, false) then
    if new.constellation_action_id is distinct from old.constellation_action_id
       or new.constellation_submitted is distinct from old.constellation_submitted then
      raise exception '성좌 쪽 제출은 성좌 참가자만 변경할 수 있습니다';
    end if;
    return new;
  end if;

  if coalesce(is_constellation, false) then
    if new.hunter_action_id is distinct from old.hunter_action_id
       or new.hunter_submitted is distinct from old.hunter_submitted
       or new.target_enemy_id is distinct from old.target_enemy_id
       or new.support_target_pair_id is distinct from old.support_target_pair_id
       or new.gimmick_note is distinct from old.gimmick_note
       or new.gimmick_stage is distinct from old.gimmick_stage
       or new.gimmick_check is distinct from old.gimmick_check then
      raise exception '헌터 쪽 제출은 헌터 참가자만 변경할 수 있습니다';
    end if;
    return new;
  end if;

  raise exception '이 페어의 참가자가 아닙니다';
end;
$$;
