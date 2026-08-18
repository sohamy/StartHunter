-- ============================================================
--  채팅
--
--  0001, 0002 를 적용한 뒤 SQL Editor 에 붙여 실행한다.
--
--  참가자와 운영자가 같은 창을 본다. 누구나 읽고 쓸 수 있고,
--  삭제는 본인 글과 운영진만 가능하다.
-- ============================================================

create table if not exists public.chat_messages (
  id             uuid primary key default gen_random_uuid(),
  -- 전투 id 또는 'GLOBAL'
  channel        text not null default 'GLOBAL',
  author         uuid references public.profiles on delete set null,
  author_handle  text not null,
  author_name    text not null,
  role           text not null default 'PARTICIPANT'
                   check (role in ('PARTICIPANT', 'OPERATOR')),
  side           text check (side in ('HUNTER', 'CONSTELLATION')),
  kind           text not null default 'TALK'
                   check (kind in ('TALK', 'ACTION', 'OOC', 'ROLL')),
  -- 다이스 결과 — kind 가 ROLL 일 때 채워진다
  dice           jsonb,
  body           text not null check (length(btrim(body)) > 0 and length(body) <= 2000),
  created_at     timestamptz not null default now()
);

create index if not exists chat_messages_channel_idx
  on public.chat_messages (channel, created_at desc);

alter table public.chat_messages enable row level security;

-- 읽기 — 참가자도 운영자도 모두 본다
drop policy if exists "chat readable" on public.chat_messages;
create policy "chat readable" on public.chat_messages
  for select to authenticated using (true);

-- 쓰기 — 자기 이름으로만 쓴다
drop policy if exists "chat insert own" on public.chat_messages;
create policy "chat insert own" on public.chat_messages
  for insert to authenticated with check (author = auth.uid());

-- 수정 — 본인 글만
drop policy if exists "chat update own" on public.chat_messages;
create policy "chat update own" on public.chat_messages
  for update to authenticated
  using (author = auth.uid()) with check (author = auth.uid());

-- 삭제 — 본인 글 또는 운영진
drop policy if exists "chat delete own or operator" on public.chat_messages;
create policy "chat delete own or operator" on public.chat_messages
  for delete to authenticated using (author = auth.uid() or public.is_operator());

-- ── Realtime ────────────────────────────────────────────
do $$
begin
  execute 'alter publication supabase_realtime add table public.chat_messages';
exception when duplicate_object then null;
end $$;
