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

> 이미 0001~0004 를 적용한 프로젝트라면 **0005 만** 실행하면 된다.
> 0005 를 적용하지 않으면 적 공격 패턴 저장과 시트 삭제가 실패한다.

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
