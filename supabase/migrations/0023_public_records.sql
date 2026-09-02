-- ============================================================
--  전투 기록 공개 링크
--
--  0022 까지 적용한 뒤 SQL Editor 에 붙여 실행한다.
--
--  공략 기록은 그 판에 있었던 사람들의 결과물인데, 읽을 수 있는 곳이 운영진 작전실
--  ARCHIVE 탭 뿐이었다. 시트에는 공개 주소(/battle/sheet/?id=)가 있는데 기록에는 없어서,
--  커뮤니티에 「우리 3층 클리어」를 붙일 방법이 없었다.
--
--  **표를 그대로 열지 않는다.** battle_records.pairs 에는 전투 종료 시점의
--  소지금과 가방이 들어 있다 — 남의 지갑은 공개할 것이 아니다.
--  (도박장 전광판에서 소지금을 뺀 것과 같은 판단이다.)
--
--  그래서 담을 것만 골라 뷰로 세운다.
--
--    담는다     작전 이름 · 층 · 위협도 · 결과 · 라운드 수 · 보스 · 기믹
--               페어별 이름 · HP · 부상 · 계약 · **이 전투에서 얻은 포인트**
--               연출 로그
--    담지 않는다 소지금 잔액 · 가방 · 운영진 메모 · 시스템 로그
--
--  「얻은 포인트」는 그 판의 성적이라 공개하고, 「가진 포인트」는 지갑이라 감춘다.
--  시스템 로그는 판정 내부(피해 계산 · 상태이상 수치)라 빼 두었다 —
--  공개하려면 아래 log 항목의 where 절만 지우면 된다.
-- ============================================================

create or replace view public.public_records
with (security_invoker = false) as
  select
    r.id,
    r.mode,
    r.operation,
    r.status,
    r.rounds,
    r.finished_at,
    r.boss_name,
    r.gimmick,

    -- 페어별 결과 — 지갑을 뺀다
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'pairId',            p->>'pairId',
            'label',             p->>'label',
            'hunterName',        p->>'hunterName',
            'constellationName', p->>'constellationName',
            'affiliation',       p->>'affiliation',
            'hunterHp',          p->'hunterHp',
            'hunterMaxHp',       p->'hunterMaxHp',
            'injury',            p->>'injury',
            'constellationStage', p->>'constellationStage',
            'contract',          p->'contract',
            'pointsEarned',      p->'pointsEarned'
          )
        ),
        '[]'::jsonb
      )
      from jsonb_array_elements(coalesce(r.pairs, '[]'::jsonb)) as p
    ) as pairs,

    -- 연출 로그만 — 사람이 쓴 글이 곧 그 판의 이야기다
    (
      select coalesce(jsonb_agg(e order by e->>'at'), '[]'::jsonb)
      from jsonb_array_elements(coalesce(r.log, '[]'::jsonb)) as e
      where e->>'channel' = 'ROLEPLAY'
    ) as log

  from public.battle_records r
  -- 끝난 판만 공개한다. 진행 중인 것을 열면 남의 전투를 들여다보는 창이 된다.
  where r.status in ('CLEARED', 'FAILED');

grant select on public.public_records to anon, authenticated;

comment on view public.public_records is
  '전투 기록 공개분. 소지금 잔액 · 가방 · 운영진 메모 · 시스템 로그는 담지 않는다.';

-- ── 확인 ────────────────────────────────────────────────
--  로그아웃 상태(anon)에서도 읽혀야 한다.
--
--    select id, operation->>'name' as name, status, rounds
--      from public.public_records order by finished_at desc limit 5;
--
--  지갑이 새지 않았는지 본다 — 아래 결과는 비어 있어야 한다.
--
--    select id from public.public_records
--     where pairs::text like '%hunterPoints%'
--        or pairs::text like '%Inventory%';
-- ============================================================
