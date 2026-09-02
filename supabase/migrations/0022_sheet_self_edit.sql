-- ============================================================
--  참가자 본인 시트 수정 — 글은 본인이, 숫자는 관리국이
--
--  0021 까지 적용한 뒤 SQL Editor 에 붙여 실행한다.
--
--  등록을 마친 참가자가 자기 시트의 오타 하나도 고칠 수 없었다. 시트를 고치는 길이
--  운영진 화면에만 있었기 때문이다. 성격 · 특징 · 계약 경위 · 사진처럼 **글**은
--  본인이 고쳐야 할 것들이다.
--
--  다만 스탯은 다르다. 한 번 정한 배분을 나중에 옮길 수 있으면 그것은 배분이 아니고,
--  전투 중에 바뀌면 이미 굴러간 판정과 어긋난다.
--
--  **이 마이그레이션은 열어 주는 것이 아니라 잠그는 것이다.**
--  `sheets update own` 정책(0001)이 이미 자기 행 전체를 열어 두고 있었다 —
--  화면이 스탯 칸을 내주지 않았을 뿐, 요청을 직접 만들면 스탯도 바뀌었다.
--  그 구멍을 여기서 닫는다. 지갑을 지키는 guard_sheet_wallet(0017)과 같은 방식이다.
-- ============================================================

-- ── 1 · 스킬에서 수치만 뽑는다 ──────────────────────────
--  스킬은 글(이름 · 설명 · 특수효과)과 수치(행동력 · 계수 · 쿨타임 · 횟수 · 상태이상)가
--  한 덩이에 섞여 있다. 글은 본인이 다듬고 수치는 관리국이 정하므로, 수치만 따로
--  뽑아 비교한다. id 로 정렬해 순서만 바뀐 것을 「달라졌다」고 보지 않는다.
create or replace function public.skill_numbers(p_skills jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',             s->>'id',
        'side',           s->>'side',
        'kind',           s->>'kind',
        'target',         s->>'target',
        'apCost',         s->'apCost',
        'power',          s->'power',
        'cooldown',       s->'cooldown',
        'maxUses',        s->'maxUses',
        'applyStatusIds', s->'applyStatusIds'
      )
      order by s->>'id'
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(coalesce(p_skills, '[]'::jsonb)) as s;
$$;

comment on function public.skill_numbers(jsonb) is
  '스킬에서 균형에 관계된 수치만 뽑는다. 글(이름 · 설명 · 특수효과)은 담지 않는다.';

-- ── 2 · 잠긴 칸 ─────────────────────────────────────────
create or replace function public.guard_sheet_locked()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- 운영진은 전부 고친다. 자동 판정보다 사람이 위라는 원칙과 같다.
  if public.is_operator() then
    return new;
  end if;

  if new.stats is distinct from old.stats then
    raise exception '스탯은 등록할 때 한 번만 정합니다. 고쳐야 하면 관리국에 문의하세요.';
  end if;
  if new.class_id is distinct from old.class_id then
    raise exception '클래스(권역)는 등록할 때 정합니다.';
  end if;
  if new.side is distinct from old.side then
    raise exception '역할(헌터 · 성좌)은 바꿀 수 없습니다.';
  end if;
  if new.affiliation is distinct from old.affiliation then
    raise exception '소속은 관리국이 정합니다.';
  end if;

  -- 이름은 편성(pair_bonds)이 복사해 두고 선물(shop_gift)이 기준으로 삼는 값이다.
  -- 혼자 바꾸면 편성표와 선물 창구가 서로 다른 사람을 가리키게 된다.
  if new.name is distinct from old.name then
    raise exception '이름은 편성과 선물이 기준으로 삼습니다. 바꿔야 하면 관리국에 문의하세요.';
  end if;

  -- 스킬은 글만 다듬는다. 수치가 바뀌면 그것은 균형 조정이다.
  if public.skill_numbers(new.skills) is distinct from public.skill_numbers(old.skills) then
    raise exception '스킬 수치(행동력 · 계수 · 쿨타임 · 횟수 · 상태이상)는 관리국이 정합니다.';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_sheet_locked on public.sheets;
create trigger guard_sheet_locked
  before update on public.sheets
  for each row execute function public.guard_sheet_locked();

-- ── 확인 ────────────────────────────────────────────────
--  참가자 계정으로 접속한 뒤:
--
--    -- 통과해야 한다 (글)
--    update public.sheets set personality = '고쳐 본다' where owner = auth.uid();
--
--    -- 거부되어야 한다 (숫자 · 이름)
--    update public.sheets set stats = '{"str":99}'::jsonb where owner = auth.uid();
--    update public.sheets set name = '다른 이름'          where owner = auth.uid();
--
--  운영진 계정에서는 위 셋 모두 통과해야 한다.
--
--  기존 시트를 건드리지 않는다 — before update 트리거이므로 이미 저장된 값은 그대로다.
-- ============================================================
