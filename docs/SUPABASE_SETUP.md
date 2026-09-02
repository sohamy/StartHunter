# Supabase 연결 안내

멀티플레이어를 위한 백엔드 설정 절차다. 프론트엔드는 GitHub Pages에 그대로 두고, 계정·전투 데이터만 Supabase에 둔다.

프로젝트: `https://gxrpywdnziqciujspupi.supabase.co`

---

## 1. 스키마 적용 (필수 · 1회)

Supabase 대시보드 → **SQL Editor** → **New query** 에
`supabase/migrations/` 의 파일을 **번호 순서대로** 붙여넣고 **Run**.

| 파일 | 내용 |
| --- | --- |
| `0001_battle_schema.sql` | 계정 · 시트 · 전투 · 편성 · 제출 · 로그 + RLS |
| `0002_roster_and_enemies.sql` | 영구 편성(`pair_bonds`) · 적 세팅(`enemy_templates`) |
| `0003_chat.sql` | 채팅(`chat_messages`) |
| `0004_gimmick_checks.sql` | 기믹 선언 · 판정 칼럼 |
| `0005_attacks_and_sheet_admin.sql` | 적 커스텀 공격(`enemy_templates.attacks`) · 시트 삭제 정책 |
| `0006_items_points_records.sql` | 아이템 가방 · 아이템 제출 · 포인트 원장 · 편성 보급품 · 공략 기록(`battle_records`) |
| `0007_sheet_portrait.sql` | 캐릭터 사진(`sheets.portrait`) · `public_profiles` 뷰에 사진 추가 |
| `0008_boss_phase_rules.sql` | 보스 페이즈 경계(`enemy_templates.phase_cutoffs`) |
| `0009_sheet_profile_split.sql` | 컨셉 분할(성격 · 특징 · 계약 경위) · 계약 상대 이름 · `public_profiles` 뷰 재정의 |
| `0010_public_sheet_full.sql` | `public_profiles` 에 스탯과 스킬 전문 포함 — 제출한 시트는 전부 공개 |
| `0011_shop_items.sql` | 상점 진열(`shop_items`) — 운영진이 품목 · 가격 · 한도를 직접 넣는다 |
| `0012_personal_points_inventory.sql` | 소지금 · 가방을 개인 소유로 (`sheets.points` · `sheets.inventory`) |
| `0013_pair_name.sql` | 페어명(`sheets.pair_name`) — 같은 이름끼리 관리국이 짝을 짓는다 |
| `0014_public_sheet_anonymous.sql` | 공개 시트를 비로그인(anon)에게도 연다 — 링크만 있으면 읽힌다 |
| `0015_shop_server_side.sql` | 구매를 서버 함수(`shop_trade`)로 옮기고, 소지금 · 가방 직접 수정을 트리거로 막는다 |
| `0016_shop_trade_guard_fix.sql` | 0015 의 트리거가 `shop_trade` 자신의 갱신까지 막던 문제 수정 — **0015 와 함께 실행** |
| `0017_personal_battle_wallet_gift_training.sql` | 전투 안까지 개인 지갑 · 선물하기(`shop_gift`) · 능력치 강화(`use_supply`) |
| `0018_sheet_name_unique_gift_by_name.sql` | 이름에 유니크 키 · 선물을 활동명이 아니라 **이름**으로 보낸다 |
| `0019_roulette.sql` | 포인트 도박장 — 룰렛 원반(`roulette_wheels`) · 회전 기록 · `roulette_spin()` |

0001 이 만드는 테이블:

| 테이블 | 내용 |
| --- | --- |
| `profiles` | 계정 · 활동명 · 역할(PARTICIPANT / OPERATOR) |
| `sheets` | 캐릭터 시트 (스탯 · 스킬) — **계정당 1개** |
| `battles` | 전투 · 적 · 기믹 · 경보 |
| `battle_pairs` | 편성과 담당 계정 |
| `submissions` | 라운드별 제출 |
| `battle_log` | 시스템 · 연출 로그 |

같이 걸리는 것: RLS 정책, 회원가입 시 프로필 자동 생성 트리거, 제출 쪽 보호 트리거, Realtime 구독 등록.

> 이미 0001~0004 를 적용한 프로젝트라면 **0005 부터** 실행하면 된다.
> 0005 를 적용하지 않으면 적 공격 패턴 저장과 시트 삭제가 실패한다.
> 0006 을 적용하지 않으면 아이템 · 포인트 원장 · 공략 기록 저장이 실패한다.
> 0007 을 적용하지 않으면 회원가입에서 사진을 올릴 때 시트 저장이 실패한다.
> 0008 을 적용하지 않으면 보스 페이즈 경계 저장이 실패한다 (경계를 안 건드리면 지장은 없다).
> 0009 를 적용하지 않으면 회원가입과 시트 저장이 실패하고, 페어 상대의 공개 시트도 뜨지 않는다.
> 0009 는 0007(사진) 을 건너뛴 프로젝트에서도 혼자 선다 — `sheets.portrait` 를 스스로 만든다.
> 0010 을 적용하지 않으면 다른 참가자의 프로필에서 스탯과 스킬 수치가 비어 보인다.
> 0011 을 적용하지 않으면 작전실에서 상점 품목을 넣을 수 없다 (기본 목록만 뜬다).
> 0012 를 적용하지 않으면 소지금 · 가방 저장이 실패한다.
> 0012 는 편성이 들고 있던 포인트 · 보급품을 두 사람에게 옮긴다 (나누지 않고 각자에게 그대로).
> 0013 을 적용하지 않으면 페어명 저장이 실패하고, 작전실의 페어명 묶음이 비어 보인다.
> 0014 를 적용하지 않으면 로그인하지 않은 사람이 공개 시트 주소를 열었을 때 빈 화면이 뜬다.
> 0014 는 시트 내용 전부(스탯 · 스킬 수치 · 소지금 · 가방)를 링크를 아는 누구에게나 연다.
> 되돌리려면 `revoke select on public.public_profiles from anon;` 한 줄이면 된다.
> 0015 를 적용하지 않으면 상점에서 구매가 실패한다 (`shop_trade` 가 없다).
> 0015 부터는 참가자가 자기 소지금 · 가방을 직접 고칠 수 없다 — 트리거가 거절한다.
> 운영진(`profiles.role = 'OPERATOR'`)은 그대로 창구에서 직접 지급 · 차감한다.
> 0015 는 코드의 기본 진열 10줄을 `shop_items` 에 심는다 (이미 손댄 줄은 건드리지 않는다).
> **0015 만 적용하면 정상 구매도 "소지금은 상점을 거쳐야 바뀝니다" 로 거절된다 — 0016 을 반드시 이어서 실행한다.**
> 0017 을 적용하지 않으면 선물하기와 강화 아이템 사용이 실패한다.
> 0018 은 이름이 겹치는 시트가 남아 있으면 **아무것도 바꾸지 않고 멈춘다** — 누가 겹치는지 알려 주므로 한쪽을 고친 뒤 다시 실행한다.
> 0019 를 적용하지 않으면 도박장(`/battle/roulette/`)이 빈 화면으로 뜨고 작전실에서 원반을 만들 수 없다.
> 0019 는 기본 원반 하나(`별자리 회전반`)를 심는다 — 원반이 이미 하나라도 있으면 두지 않으므로 다시 실행해도 늘어나지 않는다.
> 룰렛의 **뽑기는 서버(`roulette_spin`)가 한다** — 브라우저를 고쳐도 걸리는 칸은 바뀌지 않는다.
> 0009 는 기존 `concept` 에 적힌 글을 **성격** 칸으로 옮긴다 (원본 열은 지우지 않는다).

## 2. 이메일 확인 끄기 (필수)

참가자는 이메일 대신 **활동명**으로 로그인한다. 내부적으로 `활동명@hunters.local` 형태의
가상 이메일을 쓰는데, 이 주소로는 확인 메일을 받을 수 없다.

대시보드 → **Authentication → Sign In / Providers → Email** →
**Confirm email** 을 **끈다**.

이걸 켜둔 상태로는 가입은 되지만 로그인이 되지 않는다.

## 3. 운영진 계정 만들기

운영진은 캐릭터 시트가 없어도 되므로, 대시보드에서 직접 만드는 쪽이 깔끔하다.

### 방법 A — 대시보드에서 생성 (권장)

1. **Authentication → Users → Add user → Create new user**
2. 입력
   - Email: `control@hunters.local` ← 앞부분이 로그인용 **활동명**이 된다
   - Password: 원하는 비밀번호 (6자 이상)
   - **Auto Confirm User: 체크** ← 반드시 켠다
3. **Create user**
4. **SQL Editor** 에서 권한 부여:

```sql
update public.profiles set role = 'OPERATOR' where handle = 'control';
```

5. `/battle/control/` 로 접속 → **OPERATOR ACCESS** 화면에서
   활동명 `control` + 비밀번호로 로그인

> 이메일 도메인은 `@hunters.local` 로 맞춰야 한다. 활동명 → 이메일 변환 규칙이 그렇게 되어 있다.
> 실제 이메일 주소를 쓰고 싶으면 `handle` 만 맞으면 되니, 위 SQL의 `handle` 값을 확인해서 그걸로 로그인한다.

### 방법 B — 참가자로 가입한 뒤 승격

캐릭터 시트를 하나 만들게 되지만, 운영진이 캐릭터도 겸할 때 편하다.

1. `/battle/join/` 에서 일반 가입 (시트 작성)
2. SQL Editor:

```sql
update public.profiles set role = 'OPERATOR' where handle = '본인_활동명';
```

3. `/battle/control/` 접속

### 확인

```sql
select handle, role from public.profiles order by created_at;
```

### 운영진만 할 수 있는 일

전투 생성·종료 · **페어 편성** · HP/AP/상태이상/스킬 수정 · **이탈자 강제 AUTO 전환** ·
라운드 처리(APPLY) · 로그 편집 · 다음 보스 패턴 조회 · JSON Export/Import.

참가자가 이 작업을 시도하면 RLS가 거부한다.

## 3-1. 비밀번호를 잊은 참가자 구제

**이 절차가 없으면 캐릭터가 사라진다.** 활동명은 `handleToEmail()` 이 가상 이메일로
바꿔 넣는 값이라 실제로 받을 수 있는 주소가 아니다 — 그래서 **Supabase 의 메일
재설정 기능이 닿지 않는다.** 시트 · 소지금 · 가방이 모두 계정에 붙어 있으므로,
계정을 지우고 새로 만들면 그 사람의 캐릭터가 통째로 없어진다.

앱 안에는 재발급 버튼을 두지 않았다. 남의 비밀번호를 바꾸는 함수를 상시로 열어 두면
`is_operator()` 하나가 계정 탈취를 막는 유일한 방어선이 되기 때문이다. 1년에 몇 번 있을
일이라 대시보드에서 처리한다.

### 절차

1. 참가자에게 **활동명**을 확인한다.
2. Supabase 대시보드 → **SQL Editor** 에서 아래를 실행한다. 활동명과 임시 비밀번호를
   바꿔 넣는다 (임시 비밀번호는 6자 이상, 아무 값이나 좋다).

```sql
update auth.users
   set encrypted_password = crypt('임시비밀번호', gen_salt('bf')),
       updated_at = now()
 where raw_user_meta_data->>'handle' = '서윤';
```

3. 바뀐 줄이 **정확히 1개**인지 본다. 0이면 활동명이 틀린 것이고, 2 이상이면
   같은 활동명이 둘 있다는 뜻이니 멈추고 확인한다.

```sql
select id, raw_user_meta_data->>'handle' as handle, updated_at
  from auth.users
 where raw_user_meta_data->>'handle' = '서윤';
```

4. 임시 비밀번호를 참가자에게 전한다. **공개 채널에 적지 않는다.**
5. 참가자는 접속한 뒤 등록 단말(`/battle/join/`)의 **PASSPHRASE · 비밀번호** 칸에서
   자기 비밀번호로 다시 바꾼다. 이 단계까지 안내해야 한다 — 임시 비밀번호가 그대로
   남으면 그것을 아는 사람이 계속 들어올 수 있다.

### 주의

- `crypt` · `gen_salt` 는 `pgcrypto` 함수다. `extensions` 스키마에 있으므로 SQL 편집기에서
  그냥 불린다. 안 잡히면 `extensions.crypt(...)` · `extensions.gen_salt('bf')` 로 적는다.
- 이미 열려 있던 세션은 끊기지 않는다. 그 사람의 다른 기기에 로그인이 살아 있으면 그대로
  유지된다. 계정을 도둑맞아서 재발급하는 상황이라면, 위 SQL 뒤에 세션도 끊는다.

```sql
delete from auth.sessions
 where user_id = (
   select id from auth.users
    where raw_user_meta_data->>'handle' = '서윤'
 );
```

- 활동명이 아니라 계정 id 를 알고 있다면 `where id = '<uuid>'` 로 바꿔 쓰는 편이 안전하다.
  작전실 참가자 시트 카드에 그 값이 적혀 있다.

## 4. 로컬 실행

`.env` 는 이미 만들어져 있다 (git에 올라가지 않는다).

```
PUBLIC_SUPABASE_URL=https://gxrpywdnziqciujspupi.supabase.co
PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
```

```bash
npm run dev
```

환경 변수가 없으면 자동으로 LocalStorage 모드로 떨어진다 — 서버 없이도 규칙 확인은 계속 가능하다.

## 5. GitHub Pages 배포

저장소 **Settings → Secrets and variables → Actions → New repository secret** 로 두 개 등록:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`

워크플로(`.github/workflows/astro.yml`)가 빌드 시점에 주입한다.

> anon(publishable) 키는 클라이언트에 그대로 박히는 값이다. 숨겨야 하는 비밀이 아니고,
> **실제 방어선은 RLS**다. `service_role` / `secret` 키는 어떤 경우에도 저장소나 프론트엔드에 넣지 않는다.

---

## 권한 설계

### 1인 = 1캐릭터

- `sheets` 에 `unique (owner)` — 한 계정은 캐릭터 하나만 가진다
- `battle_pairs` 에 `check (hunter_account <> constellation_account)` — 한 사람이 페어의 양쪽을 맡을 수 없다
- 같은 전투에서 한 계정이 두 자리를 차지하지 못하도록 부분 유니크 인덱스를 걸었다

### 제출은 자기 쪽만

`submissions` 갱신은 트리거 `enforce_submission_side()` 가 검사한다.
헌터 참가자가 성좌 쪽 칼럼을 바꾸려 하면 예외로 거부된다 — 클라이언트를 수정해도 통하지 않는다.

### 라운드 처리 권한

전투 상태(`battles`, `battle_pairs`)에 대한 쓰기는 RLS로 **운영진만** 허용된다.
따라서 라운드 계산은 운영진 브라우저에서 실행되고, 그 결과만 서버에 반영된다.

- 참가자가 자기 HP나 피해량을 조작하는 것은 **막힌다** (쓰기 권한이 없다)
- 운영진은 어차피 수치를 직접 수정할 권한을 가진 주체다 (요구사항 원칙 3)

더 엄격하게 가려면 라운드 처리를 Edge Function으로 옮기면 된다.
`src/battle/engine/` 이 UI·저장소에 의존하지 않는 순수 함수이므로 그대로 올릴 수 있다.
다만 참가자 조작 방지 목적은 현재 구조로 이미 달성된다.

### 감춰야 하는 정보

- 룰렛 회전 기록(`roulette_spins`)의 원본은 본인과 운영진만 조회 가능. 다른 참가자에게는 `roulette_board` 뷰(이름·걸린 칸·손익)만 보이고 소지금과 계정 id 는 실리지 않는다
- 남의 `sheets`(스탯·스킬)는 본인과 운영진만 조회 가능. 다른 참가자에게는 `public_profiles` 뷰(활동명·역할·이름·클래스)만 보인다
- `submissions` 는 같은 페어 구성원과 운영진만 조회 가능
- 보스의 다음 패턴은 참가자 화면에서 `계시`로만 공개되고, 운영진 화면에는 `ADMIN ONLY` 로 항상 보인다

---

## 확인 방법

```bash
# 키가 살아 있는지
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://gxrpywdnziqciujspupi.supabase.co/auth/v1/health" \
  -H "apikey: $PUBLIC_SUPABASE_ANON_KEY"
# → 200

# 스키마가 적용됐는지
curl -s "https://gxrpywdnziqciujspupi.supabase.co/rest/v1/profiles?select=id&limit=1" \
  -H "apikey: $PUBLIC_SUPABASE_ANON_KEY" -H "Authorization: Bearer $PUBLIC_SUPABASE_ANON_KEY"
# → []  (스키마 적용 전에는 PGRST205 오류)
```

## 무료 티어 주의

프로젝트를 1주일간 사용하지 않으면 일시정지된다. 커뮤 진행 전에 대시보드에 한 번 접속해 두면 된다.
