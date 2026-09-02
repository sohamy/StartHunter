-- ============================================================
--  운영 감사 기록 — 누가 언제 무엇을 어떻게 고쳤는가
--
--  0020 까지 적용한 뒤 SQL Editor 에 붙여 실행한다.
--
--  운영진은 참가자의 소지금 · 가방 · 시트를 직접 고칠 수 있다. 그래야 운영이 되는데,
--  그 사실이 어디에도 남지 않았다. 「내 포인트가 왜 줄었냐」는 말이 나오면 근거가 없다.
--  전투 보상 원장(battles.rewards)은 전투에서 지급한 것만 담는다.
--
--  **덧붙이기만 하는 표다.** update · delete 정책을 만들지 않는다 —
--  나중에 손댈 수 있는 기록은 분쟁에서 근거가 되지 못하므로, 운영진 자신도 지울 수 없다.
--  RLS 는 정책이 없는 동작을 거부하므로 별도의 금지 규칙이 필요하지 않다.
-- ============================================================

create table if not exists public.ops_audit (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),

  -- 고친 사람. 아래 트리거가 세션에서 채운다 — 브라우저가 보내는 값은 무시된다.
  -- FK 를 걸지 않는다: 계정이 지워져도 기록은 남아야 한다.
  by_account uuid not null default auth.uid(),
  -- 그때의 활동명. 계정이 지워진 뒤에도 누가 했는지 읽히려면 값을 함께 박아 둔다.
  by_handle text not null default '관리국',

  -- 고쳐진 사람. 같은 이유로 FK 를 걸지 않는다.
  target_account uuid,
  -- 그때의 이름. 나중에 시트가 바뀌어도 기록은 그 시점을 가리켜야 한다.
  target_name text not null default '',

  action text not null check (
    action in ('POINTS', 'ITEM', 'TRADE', 'SHEET', 'SHEET_DELETE', 'SETTLE')
  ),
  -- 사람이 읽는 한 줄
  summary text not null,
  -- 왜 고쳤는가. 비어 있을 수 있다.
  reason text,

  -- 되짚을 수 있게 숫자를 남긴다. 숫자가 없는 일(시트 저장)은 null.
  before_value numeric,
  after_value numeric
);

-- 최근 것부터 읽는다
create index if not exists ops_audit_at_idx on public.ops_audit (at desc);
-- 한 사람의 이력을 뽑을 때
create index if not exists ops_audit_target_idx on public.ops_audit (target_account, at desc);

-- 남긴 사람을 서버가 박는다. 브라우저가 보낸 by_account · by_handle 은 덮어쓴다 —
-- 운영진이 여럿일 때 남의 이름으로 적는 길을 막는다.
create or replace function public.ops_audit_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.by_account := auth.uid();
  new.by_handle := coalesce(
    (select handle from public.profiles where id = auth.uid()),
    '관리국'
  );
  return new;
end;
$$;

drop trigger if exists ops_audit_stamp on public.ops_audit;
create trigger ops_audit_stamp
  before insert on public.ops_audit
  for each row execute function public.ops_audit_stamp();

alter table public.ops_audit enable row level security;

-- 운영진만 남긴다. by_account 를 세션과 묶어 남의 이름으로 적는 길을 막는다.
drop policy if exists "ops_audit insert by operator" on public.ops_audit;
create policy "ops_audit insert by operator" on public.ops_audit
  for insert to authenticated
  with check (public.is_operator() and by_account = auth.uid());

-- 운영진만 읽는다. 남의 지갑 이력은 참가자에게 보일 것이 아니다.
drop policy if exists "ops_audit read by operator" on public.ops_audit;
create policy "ops_audit read by operator" on public.ops_audit
  for select to authenticated
  using (public.is_operator());

-- update · delete 정책은 만들지 않는다. 덧붙이기만 하는 표다.

-- ── 확인 ────────────────────────────────────────────────
--  운영진 계정으로 접속한 뒤 작전실에서 소지금을 한 번 지급하고,
--  아래 결과에 한 줄이 늘었는지 본다.
--
--    select at, action, target_name, summary, reason
--      from public.ops_audit order by at desc limit 10;
--
--  참가자 계정으로 같은 질의를 하면 빈 결과가 나와야 한다 (RLS).
--  운영진이 지우려 해도 거부되어야 한다.
--
--    delete from public.ops_audit;   -- 0 rows, 정책 없음
-- ============================================================
