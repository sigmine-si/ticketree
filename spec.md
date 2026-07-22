# Ticket Tree — 기획서

Spec Driven Development 기반 외주 개발 운영 플랫폼. 클라이언트가 요구사항을 대화로 확정하면, Claude Code 에이전트가 코드를 탐색·구현하고, 관리자가 Spec과 배포를 승인하는 구조다.

작성일: 2026-07-21 · 상태: 기획 확정 (MVP 착수 기준서)

---

## 1. 제품 개요

이 플랫폼은 우리 팀이 외주/클라이언트 프로젝트를 관리하는 내부 도구다. 신규 웹앱 제작과 기존 repo 유지보수를 모두 다룬다. 핵심 원리는 세 가지다.

**Spec이 계약서다.** 모든 프로젝트는 기능별 명세(specs/features/*.md)를 가지며, 이것이 클라이언트와의 약속, 에이전트의 구현 기준, 검수의 테스트 기준을 겸한다. Spec은 클라이언트가 읽을 수 있는 언어로 작성한다("회원이 음료를 주문하면 결제 완료 시점에 스탬프가 1개 적립된다"). 기술 세부사항은 Spec이 아니라 digest와 탐색 노트에 둔다.

**모든 답은 코드를 본 뒤에 나온다.** 클라이언트의 요청·질문에 대한 응답은 에이전트가 실제 코드베이스를 read-only로 탐색한 결과에 근거한다. 클라이언트의 AS-IS 인식과 실제 코드가 다르면 그 차이 자체가 1순위 확인 질문이 된다.

**사람이 게이트를 지킨다.** 클라이언트는 견적을 승인하고, 관리자는 Spec 변경과 배포를 승인한다. 에이전트는 브랜치와 PR까지만 만들며, 비가역적 동작(머지, 배포)은 반드시 사람의 승인 뒤에 러너가 실행한다.

## 2. 핵심 플로우

접수부터 배포까지 한 요청의 여정은 다음과 같다.

클라이언트가 포털에서 "새 요청"을 열고 AS-IS(지금은 이래요) / TO-BE(이렇게 바뀌면 좋겠어요)를 작성해 보낸다. 보내는 즉시 draft가 생성되고 탐색 job이 시작되며, 모달은 대화 화면으로 전환되어 버퍼링 상태 문구(에이전트 스트림에서 파생)를 보여준다. 에이전트가 코드를 확인한 뒤 확인 질문을 보내고, 클라이언트가 답하면 필요 시 추가 라운드가 이어진다. 내용이 확정 가능해지면 변경 요청서 요약과 러프 견적을 제시하고, 클라이언트가 "이 내용으로 요청하기"를 누르는 순간 티켓이 정식 발행된다. 대화가 길어지면 클라이언트는 언제든 닫을 수 있고("준비되면 알려드릴게요") 이후는 비동기 스레드로 이어진다.

티켓 확정 후 견적 산출 job이 확정 견적과 Spec 변경안(diff)을 만들고, 클라이언트가 견적을 승인하면 관리자 검토 큐에 올라간다. 관리자가 Spec diff·탐색 노트·문답 기록을 근거로 승인하면 Spec PR이 머지되고 구현 job이 큐에 등록된다. 구현이 끝나면 repo별 코드 PR과 preview가 생성되고, 관리자가 배포를 승인하면 러너가 의존 순서대로 머지·배포한다. 배포 완료 시 Spec의 "예정" 항목이 정식 반영되고 digest가 갱신된다.

## 3. 클라이언트 경험

포털은 세 화면으로 구성된다. 목업 파일: `client-portal-mockup.html`.

**요청 내역(메인)** — 티켓 테이블. 각 행에 4단계 세그먼트 트랙, 견적, 업데이트 시각이 표시된다. 클라이언트가 움직여야 하는 행은 앰버 점 + 상단 요약("답변이 필요한 요청 2건")으로 강조한다. 상단 스트립에 월 확정 견적 합계를 표시한다.

**요청 스레드** — 요청 원문, 시스템 메시지(코드 확인 완료), 문답 카드, 견적 카드, 미리보기 링크가 타임라인으로 쌓인다.

**서비스 명세** — 기능별 수용 기준을 "이렇게 동작해요" 체크리스트로 표시한다. 진행 중 요청으로 추가될 항목은 "예정 · REQ-XXX" 태그로 미리 자리를 잡고, 변경 이력은 버전·REQ 번호와 함께 표시되어 요청 스레드로 역추적된다.

클라이언트에게 보이는 진행 단계는 4개다: **접수됨 → 개발 중 → 개발 완료 → 배포 완료**. 접수됨 내부의 세부 상황(코드 확인 중 / 답변 필요 / 견적 확인)은 단계가 아니라 앰버 플래그와 한 줄 메타 문장으로 전달한다.

## 4. 접수 대화 스펙

접수 폼의 필수 입력은 TO-BE 하나뿐이다(AS-IS·첨부·희망 시점은 선택). 제목은 제출 시 LLM이 자동 생성한다.

질문 라운드에는 **상한이 없다**. 종료 조건은 단 하나, "변경 요청서가 확정 가능한 상태인가"이다. 대신 수렴을 보장하는 규칙을 질문 생성의 스펙으로 둔다: (1) 한 라운드에는 서로 독립적인 질문만 최대 3개 배칭하고, 답에 따라 갈리는 조건부 질문은 다음 라운드로 미룬다. (2) 견적이나 명세에 영향을 주지 않는 질문은 금지한다. (3) 매 라운드 응답에 남은 미확정 항목을 알려 진행감을 준다("이제 알림 방식만 정하면 견적을 드릴 수 있어요"). (4) 독립적으로 배포 가능한 변경이 섞여 있으면 티켓 분리를 제안한다. 클라이언트 메시지 수는 제한하지 않는다.

안전장치는 라운드 수가 아니라 신호 기반이다. 같은 항목 재질문, 답변할수록 커지는 범위, 장기 무응답이 감지되면 관리자 대시보드에 알림을 올린다(강제 종료 아님, 개입 여부는 사람이 결정). 컨텍스트 비용은 토큰 임계치 도달 시 확정 사항·미확정 리스트를 요약해 새 세션으로 갈아타는 방식으로 관리한다.

세션 구현: 라운드 = `claude -p --resume <session_id>` 한 턴. 첫 실행에서 `--output-format json`으로 session_id를 받아 draft에 cwd와 함께 저장하고, 클라이언트 답변이 올 때마다 같은 폴더에서 재개한다. 턴 사이에 프로세스는 죽어 있으며 자원을 점유하지 않는다. 확정 시 세션을 종료하고 탐색 노트와 변경 요청서만 다음 단계(견적·구현)로 넘긴다 — 구현 job은 대화 세션을 상속하지 않고 깨끗하게 시작한다.

## 5. 관리자 경험

목업 파일: `admin-dashboard-mockup.html`. 메인은 현황판이 아니라 **결정 큐**다. 테이블 컬럼은 상태가 아니라 "필요한 결정"(Spec 승인 / 배포 승인 / 답변 필요)이며, 결정 필요 우선으로 정렬된다. 에이전트가 Spec 충돌·모호함을 발견해 멈춘 에스컬레이션은 빨간 "답변 필요" 행으로 올라온다.

검토 상세는 승인 근거 3종(Spec diff, 탐색 노트, 클라이언트 문답)과 결정 버튼으로 구성된다. 견적 카드에는 예상 작업량, 예상 AI 원가, 유사 규모 과거 건의 평균 원가가 나란히 표시되고 청구 금액을 조정할 수 있다. 승인 버튼 아래에는 버튼이 일으키는 비가역적 동작을 명시한다("승인하면 PR #47이 머지되고 구현 job이 큐에 등록됩니다").

상단에는 러너 상태 칩(runner 1/1 · queue 2), 오늘 AI 원가, 월 확정 견적·원가율이 상시 표시된다.

## 6. 아키텍처

구성 요소는 넷이다: Next.js 웹앱(포털+대시보드), Postgres(워크플로우 상태), 에이전트 러너(job 오케스트레이터), GitHub(코드·Spec·PR). 웹앱과 에이전트는 직접 통신하지 않는다 — 모든 상태는 DB를 거치고 모든 코드·Spec은 GitHub를 거친다. 설계 원칙: **상태는 DB, 진실은 Git, 러너는 일회용.**

웹앱과 러너는 같은 서버에 동거하되 별개 프로세스이며, 같은 파일시스템에 있어도 통신은 DB로만 한다(러너를 나중에 분리할 수 있도록).

### 서버 구조

```
/srv/ticketree/                       # 운영 루트
├── current/                     # 플랫폼 배포본 (소모품 — 배포마다 갈아끼움)
│   ├── web/                     #   Next.js — systemd: ticketree-web (:3000)
│   ├── runner/                  #   오케스트레이터 — systemd: ticketree-runner
│   └── shared/                  #   타입·상태 enum 공유
├── config/
│   └── platform.env             # 플랫폼 크리덴셜 (러너 금고 — §10)
└── workspaces/                  # 영속 데이터 (백업 대상)
    └── {project}-hub/           # 프로젝트당 허브 repo 클론
```

앞단에 Caddy(자동 HTTPS 리버스 프록시). 플랫폼 배포는 GitHub Actions → ssh → pull·빌드·재시작. 웹은 즉시 재시작, 러너는 드레인 방식(새 job 안 집고 진행분 완료 후 교체). current/는 백업하지 않고(원본은 GitHub) workspaces/와 config/만 백업한다.

### repo 구조 (§16-12에서 개정)

**명세와 코드는 한 저장소에 산다.** `specs/`가 계약, `src/`가 구현이다. 프로젝트당 저장소 하나가 기본이며, 그 저장소가 명세·규칙·코드를 모두 담는다.

```
workspaces/greenloop-mall/       # 저장소 클론
├── CLAUDE.md                    # 플랫폼 규칙 + 프로젝트 규칙 + 코드 규칙
├── specs/features/*.md          # 기능 단위 명세 (계약)
├── digest.md                    # 코드 지도 (구현 job이 갱신)
├── src/                         # 실제 코드
├── .env                         # (gitignored)
└── work/                        # (gitignored) 구현 작업장 — git worktree, 브랜치 dev/REQ-014
    └── REQ-014/
```

Spec PR과 코드 PR은 같은 저장소의 서로 다른 브랜치다. 요청 하나 = Spec PR 하나(`specs/`만 건드림) + 코드 PR 하나(`src/`만 건드림). 명세는 먼저 승인·머지되고(§7 첫 게이트) 코드는 그 뒤에 온다.

멀티 repo 프로젝트(예: 서버 저장소 + 앱 저장소가 분리된 경우)는 후순위다. 그때는 대표 저장소 하나를 정해 그 `specs/`를 단일 진실로 삼고, 나머지 저장소에는 코드 PR만 만든다. MVP 범위는 단일 저장소만 다룬다.

CLAUDE.md 계층: 허브 루트의 CLAUDE.md에 플랫폼 규칙(specs가 유일한 진실, 탐색 노트 출력 포맷, main 직접 push 금지, Spec 충돌 발견 시 질문 생성 후 중단)을 두고, 각 코드 repo의 CLAUDE.md에 repo 고유 규칙을 둔다. job 시점 지시는 `--append-system-prompt`로 주입한다.

### 에이전트 실행 모델

Claude Code headless(`claude -p`)를 job 단위로 실행하고 끝나면 폐기한다. 인증은 `claude setup-token`으로 만든 구독 OAuth 토큰(`CLAUDE_CODE_OAUTH_TOKEN`)을 러너가 주입한다. 러너 코드는 인증 방식을 모르게 하여(환경 변수 하나 차이) API 키 전환 스위치를 유지한다.

레인은 둘이다. **대화 레인**: 접수 대화·탐색·견적 산출(read-only, 속도 예산 2~3분, cwd = 허브 루트). **작업 레인**: 구현·온보딩(쓰기 가능, cwd = work/{REQ}/). 프로젝트·레인별 락으로 동시 실행을 제어하며, 대화 진행 중인 프로젝트의 repo/를 구현 job이 건드리지 않도록 worktree로 작업 공간을 분리한다. 글로벌 동시 실행 상한은 설정값(초기 1~2).

job 공통 가드레일: `--max-turns`, 타임아웃, 토큰 예산. 출력은 `--output-format stream-json`으로 받아 파싱해 DB에 기록한다(대화 버퍼링 상태 문구, job 로그, 토큰 사용량·원가). 원본 스트림은 S3에 아카이브한다.

cwd가 격리·세션·시야를 모두 결정한다. 에이전트의 cwd가 될 수 없는 곳: current/(실행 중인 플랫폼), config/(비밀), 다른 프로젝트의 workspaces. 격리 강화 로드맵: 현재(단일 유저 + permission 설정) → 프로젝트별 리눅스 유저(홈·세션 OS 격리, 토큰은 프로세스별 주입) → 컨테이너.

### 도그푸딩

플랫폼 자신을 프로젝트로 등록한다(workspaces/ticketree-hub/). 같은 ticketree repo가 서버에 두 번 존재한다: current/(실행본, 배포 파이프라인만 접근)와 workspaces 하위 클론(에이전트의 작업 대상). 에이전트의 변경은 반드시 GitHub PR과 배포 파이프라인을 경유해서만 실행본에 도달한다. 이 프로젝트의 배포 어댑터는 예외 없이 manual이다.

## 7. 상태 머신

내부 status(약 12개)와 클라이언트 표시 stage(4개)를 분리한다.

| stage (클라이언트) | status (내부) |
|---|---|
| (비노출) | `draft` — 접수 대화 중, 확정 전 |
| 접수됨 | `submitted` `queued_exploration` `exploring` `awaiting_client` `estimating` `quote_ready` |
| 개발 중 | `client_approved`(관리자 Spec 승인 대기 포함) `queued_dev` `developing` |
| 개발 완료 | `in_review` — 미리보기 확인 |
| 배포 완료 | `deployed` (종결) |

루프: awaiting_client → exploring(답변이 재탐색을 요구할 때), in_review → developing(검수 수정). 횡단 상태는 stage 위치를 보존한 채 얹히는 플래그로 다룬다: `escalated`(에이전트 질문 — 관리자 답변 대기), `failed`(job 실패 — 1회 자동 재시도 후 에스컬레이션), `on_hold`, `cancelled`.

모든 상태 전이는 request_events에 기록한다. 클라이언트 타임라인, 관리자 감사 추적, 단계별 소요 시간 분석(견적 보정)이 전부 이 로그에서 나온다.

이중 게이트: 클라이언트의 견적 승인("이 내용과 가격에 동의")과 관리자의 Spec 승인("기술적으로 타당하고 에이전트를 풀어도 안전")은 다른 판단이므로 둘 다 거친다. 관리자 게이트 구간은 클라이언트에게 "개발 중"으로 보인다.

## 8. 견적 모델

2단계: 접수 대화 확정 시점의 **러프 견적**(범위 표시, 예: 40~55만원)과 견적 산출 job의 **확정 견적**(작업 분해 + 예상 AI 원가 + 검토 시간). 관리자가 청구 금액을 조정해 확정할 수 있다.

피드백 루프가 이 플랫폼의 데이터 자산이다. 모든 job의 실제 토큰·원가·소요 시간을 기록하고, 견적 화면에 유사 규모 과거 건의 평균 원가·소요를 표시한다.

원가 계측은 실측으로 확인했다 — 구독 인증에서도 `--output-format json`의 result 이벤트에 `total_cost_usd`와 모델별 `modelUsage`가 나온다. 따라서 토큰과 화폐 원가를 둘 다 쌓는다. 다만 이 금액은 **API 환산가이지 구독 실지출이 아니므로**, 대시보드 표기는 "AI 원가(환산)"로 하고 원가율은 참고 지표로만 쓴다.

모델 선택이 원가를 지배한다. 실측에서 파일 1개짜리 사소한 질의가 Opus 기준 $0.185(≈₩250)였고 캐시 read만 41k 토큰이었다. 레인·job kind별로 모델을 분리한다: 탐색·접수 대화·견적 산출은 Sonnet, 구현은 Opus를 기본으로 하고 `projects.settings.models`로 프로젝트별 오버라이드를 허용한다.

## 9. DB 스키마 (RDS Postgres)

인스턴스는 db.t4g.micro(단일 AZ)로 시작하며, `ticketree` 데이터베이스를 사용한다. 같은 인스턴스에 다른 프로젝트의 DB를 함께 둘 수 있다(프로젝트별 DATABASE + 전용 유저·권한 분리). 큐·락은 별도 인프라 없이 Postgres로 해결한다.

```sql
-- 프로젝트와 저장소
projects (
  id uuid PK, slug text UNIQUE, name text, client_name text,
  status text,                    -- provisioning | active | paused | archived
  hub_repo text,                  -- org/cafe-app-hub
  workspace_path text,            -- /srv/ticketree/workspaces/cafe-app-hub
  deploy_adapter text,            -- vercel | manual
  settings jsonb,                 -- stall_alert_after, lane 상한, models 오버라이드
  next_req_no int NOT NULL DEFAULT 1,   -- 채번 카운터 (§16-4)
  created_at timestamptz
)
repos (
  id uuid PK, project_id FK, name text,        -- api, web
  github_full_name text, role text,
  deploy_order int, deploy_adapter text
)

-- 사용자 (클라이언트는 초대링크+PIN, 관리자는 아이디+비밀번호 — §16-1)
users (
  id uuid PK, project_id FK NULL,              -- admin은 NULL
  kind text,                                   -- client | admin
  name text,
  invite_token_hash text NULL, pin_hash text NULL,   -- client 전용
  github_login text NULL, github_id bigint NULL,     -- admin 전용
  created_at, last_seen_at,
  UNIQUE (github_id)
)

-- 변경 요청 (티켓)
change_requests (
  id uuid PK, project_id FK, req_no int,       -- 프로젝트 내 일련번호
  title text, as_is text, to_be text, urgency text,
  stage text, status text,                     -- §7
  flag text NULL,                              -- escalated | failed | on_hold | cancelled
  flag_from_status text NULL,
  your_turn boolean,                           -- 앰버 플래그
  created_at, confirmed_at, deployed_at,
  UNIQUE (project_id, req_no)
)

-- 접수 대화
messages (
  id uuid PK, request_id FK, round int,
  role text,                                   -- client | agent | system
  content text,
  created_at
)
-- 질문 단위 답변 (§16-2) — 목업의 "1/2 답변됨"이 여기서 나온다
message_questions (
  id uuid PK, message_id FK, idx int,
  prompt text, hint text NULL,
  kind text,                                   -- choice | free | choice_or_free
  options jsonb,                               -- ["아메리카노만", ...]
  answer_text text NULL,                       -- 자유 입력 또는 선택지 라벨
  answer_option_idx int NULL,
  answered_at timestamptz NULL,
  UNIQUE (message_id, idx)
)
-- 첨부 (§16-3)
attachments (
  id uuid PK, request_id FK, message_id FK NULL,
  filename text, content_type text, byte_size bigint,
  s3_key text, uploaded_by FK, created_at
)
agent_sessions (
  id uuid PK, request_id FK,
  session_id text, cwd text,                   -- resume에 둘 다 필요
  kind text,                                   -- intake | implementation
  token_total bigint, started_at, last_resumed_at, closed_at
)

-- job 큐 (러너가 FOR UPDATE SKIP LOCKED로 클레임)
jobs (
  id uuid PK, request_id FK NULL, project_id FK,
  lane text,                                   -- chat | work
  kind text,        -- exploration | intake_round | estimation | implementation | onboarding | deploy
  status text,                                 -- queued | running | done | failed
  claimed_by text NULL, worktree_path text NULL,
  session_ref uuid FK NULL,
  tokens_in bigint, tokens_out bigint, cost_krw numeric NULL,
  result jsonb, error text,
  queued_at, started_at, finished_at
)

-- 견적
estimates (
  id uuid PK, request_id FK, version int,
  rough_min int NULL, rough_max int NULL,      -- 러프 (원)
  proposed_amount int NULL,                    -- AI 확정 제안가
  final_amount int NULL,                       -- 관리자 조정 확정가
  cost_estimate_tokens bigint, wbs jsonb,
  client_approved_at, admin_id FK NULL, created_at
)

-- Spec과 PR
spec_versions (
  id uuid PK, project_id FK, feature text,     -- coupon
  version text, request_id FK, hub_pr int,
  status text,                                 -- proposed | merged | rejected
  summary text, merged_at
)
pull_requests (
  id uuid PK, request_id FK, repo_id FK NULL,  -- NULL이면 허브(Spec) PR
  kind text,                                   -- spec | code
  pr_number int, status text, head_sha text NULL,
  preview_url text NULL,                       -- manual 어댑터면 운영자가 입력
  merged_at timestamptz NULL
)

-- 이벤트 로그 (모든 전이)
request_events (
  id bigserial PK, request_id FK,
  from_status text, to_status text,
  actor_kind text,                             -- client | admin | agent | system
  actor_id uuid NULL, meta jsonb, created_at
)

-- 수동 알림 큐 (대시보드 뱃지용 — §11)
pending_notices (
  id uuid PK, request_id FK,
  type text,     -- question_arrived | quote_ready | preview_ready | deployed
  created_at, dismissed_at NULL
)
```

집계(월 확정 견적, 원가율, 유사 건 평균)는 카운터 없이 SQL 뷰/쿼리로 처리한다. 클라이언트 데이터 격리는 앱 레벨로: 모든 조회가 세션의 project_id로 스코프되는 데이터 접근 계층을 강제한다.

S3 버킷 구조: `archives/{project}/{req}/{job}/stream.jsonl·notes.md`(job 원본 로그·탐색 노트), `uploads/{project}/{req}/`(클라이언트 첨부). 종결 요청의 로컬 세션 파일(~/.claude/projects/)은 크론으로 정리한다.

## 10. 인증과 비밀

**클라이언트 로그인**: 초대 링크(capability URL) + PIN. 운영자가 온보딩 때 토큰 링크를 생성해 카톡 등으로 전달하고, 첫 접속 시 PIN을 설정한다. 재발급 버튼으로 토큰 무효화 가능. (이메일 발송 기능은 두지 않는다.)

**에이전트 인증**: Claude 구독 OAuth 토큰. 정책 리스크(제3자 요청을 처리하는 자동화 서비스에 개인 구독 사용)와 한도 공유·job별 원가 미측정 한계를 인지한 상태의 결정이며, Anthropic 정책 확인을 권고사항으로 남긴다. 러너는 인증 방식을 추상화하여 API 키 전환이 환경 변수 교체로 끝나게 한다.

**비밀 배치 기준 — "폭발 반경이 프로젝트 하나를 넘는 비밀만 러너 금고에".** 워크스페이스(에이전트 시야) 안: 테스트·스테이징 수준의 env(각 repo의 .env — 통상 개발 환경 그대로). platform.env(에이전트 시야 밖): GitHub App 개인키, Claude OAuth 토큰, DB 마스터 접속, 프로젝트별 프로덕션 배포 토큰. 근거는 에이전트 불신이 아니라 입력 불신이다 — 클라이언트 문구와 클라이언트 repo 내용이 컨텍스트로 들어가는 구조에서 프롬프트 주입 시 시야 내 비밀은 유출될 수 있다고 가정한다. 배포는 러너의 일이므로 프로덕션 토큰이 워크스페이스에 없어도 흐름에 지장이 없다.

## 11. 알림 (수동 운영)

자동 발송 채널은 두지 않는다. "당신 차례" 전환 4종(질문 도착·견적 확인·미리보기 확인·배포 완료)이 발생하면 pending_notices에 쌓이고, 관리자 대시보드에 뱃지 + 클라이언트 전달용 문구·링크 복사 버튼으로 표시된다. 운영자가 카톡 등으로 직접 전달한다. request_events 훅 자리는 유지하여 추후 채널(이메일·알림톡) 연결이 훅 하나로 끝나게 한다. 관리자용 즉시 알림(에스컬레이션·job 실패)은 운영자가 실제로 보는 채널의 웹훅 하나로 처리한다.

## 12. 프로젝트 온보딩 (운영자 플로우)

입력은 최소로: 프로젝트명, 클라이언트 이름, 유형(신규/기존 인수), 대상 repo, 배포 어댑터. 이후 프로비저닝 job이 자동 수행: 허브 repo 생성(hub-template), 신규면 코드 repo 생성, 기존이면 GitHub App 설치(클라이언트 조직 소유 시 설치 요청 링크 표시 후 webhook 대기), 서버 워크스페이스 클론, .env 스캐폴드, DB 행·클라이언트 계정 생성.

프로비저닝 후 **온보딩 탐색 job**이 한 번 돈다(시간·토큰 넉넉히): repo별 digest 초안 생성, 기존 인수인 경우 코드에서 현재 동작을 역추출한 Spec 초안 작성. 이것이 없으면 기존 프로젝트에서 SDD가 시작될 수 없다.

운영자 수동 체크리스트(대시보드에 진행 표시): .env 값 채우기 → 배포 자격증명 등록 → Spec 초안 검토·다듬기(온보딩에서 가장 가치 있는 수동 작업, 15~30분) → 스모크 테스트(가짜 요청 1건으로 탐색→질문→견적 확인) → 활성화. 클라이언트 초대는 활성화 후 마지막에 — 첫 로그인 시 명세가 이미 채워진 상태를 만나게 하고, "명세에서 실제와 다른 부분을 알려달라"를 첫 상호작용으로 유도한다.

## 13. 기술 스택 확정

| 레이어 | 선택 |
|---|---|
| 언어·repo | TypeScript 전면, ticketree 모노레포 (web/ runner/ shared/, pnpm) |
| 웹앱 | Next.js (App Router) + Tailwind — 목업 디자인 토큰(Pretendard + IBM Plex Mono, 딥그린) 이식 |
| DB | RDS Postgres db.t4g.micro 단일 AZ (~$22/월, 신규 계정 프리티어 12개월) + S3 아카이브 |
| 큐·락 | Postgres `FOR UPDATE SKIP LOCKED` + 러너 폴링, 프로젝트·레인별 락 |
| 실시간 | SWR 폴링(5~10초). 접수 대화 버퍼링만 SSE(1~2초 DB 조회 릴레이) |
| 에이전트 | Claude Code headless: `-p` `--resume` `--output-format stream-json` `--max-turns`, 구독 OAuth 토큰 |
| 경량 LLM | Anthropic Messages API 직접 (라우팅 3분류·제목 생성 등 코드 불필요 호출만) |
| Git | GitHub App + Octokit + webhook, git worktree |
| 서버 | 단일 서버 + Caddy + systemd 2유닛, GitHub Actions ssh 배포 |
| 클라이언트 배포 | 어댑터 패턴: vercel / manual (인터페이스만 고정) |
| 인증 | 자체 초대링크 + PIN |
| 관측 | request_events + job 토큰·원가 + S3 stream.jsonl, Sentry(선택) |

외부 의존: AWS(RDS·S3), GitHub, Anthropic(구독), 프로젝트별 Vercel — 넷.

## 14. 리스크와 완화

1순위 — 구독 인증의 정책·한도 리스크. 완화: 인증 추상화(전환 = 환경 변수 교체), Anthropic 정책 확인, 관리자 승인 게이트로 "운영자가 실행 주체"인 구조 유지. 2순위 — 대화 레인 응답 속도(2~3분 예산이 제품 품질). 완화: 레인별 effort 설정(§16-11), 레인 분리, 탈출구 UX. **"digest 기반 탐색 단축"은 완화책에서 뺀다 — 계측 결과 파일 탐색은 병목이 아니었다(§16-11).** 3순위 — 멀티 repo preview. 완화: "api는 스테이징 선배포 → web preview가 스테이징 참조"로 시작, 요청별 통합 preview는 후순위. 4순위 — 프롬프트 주입. 완화: 비밀 배치 기준(§10), read-only 레인, 비가역 동작의 사람 게이트, main push 금지.

## 15. MVP 범위

포함: 프로젝트 1~2개(도그푸딩 + 실 클라이언트 1), 접수 대화(버퍼링·멀티 라운드·탈출구), 티켓 테이블·스레드·명세 화면, 관리자 검토 큐·Spec diff 검토·견적 조정, 탐색/견적/구현 job + 큐·락·가드레일, 허브 repo·worktree, 수동 알림 뱃지, 온보딩 반자동(스크립트 + 체크리스트).

제외(후순위): 자동 알림 채널, 요청별 통합 preview, 프로젝트별 리눅스 유저·컨테이너 격리, 견적 보정 모델(데이터만 축적), 정산·청구서, 온보딩 완전 자동화.

검증 순서: 도그푸딩 프로젝트로 전체 파이프라인 1바퀴 → 실 클라이언트 1곳 온보딩 → 요청 10건 처리하며 견적 정확도·탐색 속도·에스컬레이션 빈도 측정.

## 16. 기획 마무리 — 확정 사항

착수 직전 검토에서 드러난 빈칸을 여기서 닫는다. §1~15와 충돌하면 이 절이 우선한다.

**16-1. 관리자 인증 — 아이디 + 비밀번호.** 관리자는 `.env`의 `ADMIN_ID` / `ADMIN_PASSWORD` 한 쌍으로 로그인한다. 둘 다 상수시간으로 대조하고, 통과한 뒤에야 `users` 행을 `kind='admin'`으로 생성한다. 클라이언트는 §10의 초대링크+PIN 그대로이며, 두 인증은 별개 세션 쿠키를 쓴다. 관리자가 우리 팀 한 명뿐인 동안은 외부 인증 제공자를 끌어들일 이유가 없다 — 계정이 늘거나 외부에 열 때 해시 저장 + users 기반으로 옮긴다.

**16-2. 질문 단위 답변.** 라운드 안의 개별 질문을 `message_questions` 행으로 쪼갠다. 클라이언트는 질문 하나씩 답할 수 있고, 진행률("1/2 답변됨")은 이 테이블의 집계다. **한 라운드의 모든 질문이 답변되는 순간** 다음 `intake_round` job이 큐에 등록된다 — 부분 답변으로는 에이전트를 깨우지 않는다.

**16-3. 첨부.** `attachments` 테이블 + S3 `uploads/{project}/{req}/`. 업로드는 presigned PUT. 에이전트에게는 파일 경로가 아니라 **텍스트로 추출한 내용만** 전달한다(이미지는 첨부 자체를 컨텍스트에 넣지 않고 "첨부 N건 있음"으로만 알린다 — 프롬프트 주입 표면을 줄이기 위해, §10의 입력 불신 원칙).

**16-4. req_no 채번.** `projects.next_req_no`를 요청 생성 트랜잭션 안에서 `UPDATE ... SET next_req_no = next_req_no + 1 RETURNING` 으로 원자적으로 소비한다. `max(req_no)+1` 방식은 경합에서 깨지므로 쓰지 않는다.

**16-5. 락.** 별도 락 테이블을 두지 않는다. job 클레임은 `SELECT ... FOR UPDATE SKIP LOCKED`, 프로젝트·레인 상호배제는 `pg_advisory_xact_lock(hashtext(project_id || ':' || lane))`. 글로벌 동시 실행 상한은 러너 프로세스의 설정값으로 강제한다.

**16-6. deploy_adapter='manual'의 동작.** 배포 승인 시 러너는 `repos.yml` 의존 순서대로 PR을 머지하는 데까지만 하고, manual 어댑터는 실제 배포를 수행하지 않는다. 대신 요청을 `awaiting_manual_deploy` 상태로 두고 `pending_notices`에 `manual_deploy_required`를 쌓는다. 운영자가 대시보드에서 "배포 완료로 표시"를 누르면 `deployed`로 종결되고 Spec의 "예정" 항목이 정식 반영된다. `preview_url`도 manual 프로젝트에서는 운영자가 직접 입력한다. **클라이언트에게는 이 구간이 "개발 완료"로 보인다** — manual이라는 사실은 노출하지 않는다.

**16-7. 상태 추가.** §7의 "개발 완료" stage에 `awaiting_manual_deploy`를 추가한다(`in_review` 다음, `deployed` 앞).

**16-8. 도그푸딩 경계.** 플랫폼 v0는 손으로 만든다. ticketree 프로젝트는 슬라이스 1에서 **등록만** 하고(탐색 대상으로서), 자기 자신의 요청을 실제로 구현·배포하기 시작하는 시점은 구현 job과 배포 승인이 동작하는 **슬라이스 4 이후**다. 그 전에 도그푸딩을 시도하면 부트스트랩이 자기 자신을 기다리는 교착에 빠진다.

**16-9. read-only 강제 (신규 — §6 보강).** "read-only 레인"을 주석이 아니라 플래그로 강제한다. 러너가 job kind에서 레인을 결정하고 레인이 플래그를 결정한다 — 프롬프트가 이걸 바꿀 수 없다.

| 레인 | cwd | 도구 | 모델 | effort |
|---|---|---|---|---|
| chat (탐색·접수·견적) | 허브 루트 | `--tools Read Grep Glob` 화이트리스트 | Sonnet | medium |
| work (구현·온보딩) | `work/{REQ}/` | 쓰기 포함 전체 | Opus | high |

`--dangerously-skip-permissions`는 러너 코드 어디에도 두지 않는다. 실측에서 상속된 `bypassPermissions`로 실행된 사례가 있었으므로, 러너는 permission mode를 **명시적으로** 지정하고 부모 환경에서 상속받지 않는다.

**16-10. 에이전트 실행 실측 결과 (§4·§6 전제 확인됨).**
- `--resume <session_id>`는 프로세스가 완전히 죽은 뒤에도 대화 맥락을 복원한다 — 턴 간 자원 미점유 전제 성립.
- `--output-format stream-json --verbose`는 `system:init` → `assistant` → `result` 순으로 흐르며, `init`에 `session_id`·`cwd`·`model`·`permissionMode`가 모두 들어 있다. 버퍼링 상태 문구는 `assistant`·tool_use 이벤트에서 파생한다.
- cwd 격리는 spawn의 `cwd` 옵션으로 정상 동작한다(셸 `cd`에 의존하지 않는다).
- `result` 이벤트에 `total_cost_usd`·`modelUsage`·`num_turns`·`duration_ms`가 있어 job 단위 계측이 바로 된다.

**16-11. 대화 레인 지연의 실체 (§14 2순위 정정).**

기획 단계에서는 응답 지연의 원인을 "탐색이 오래 걸린다"로 가정하고 digest 기반 탐색 단축을 완화책으로 잡았다. 턴별로 계측해보니 **틀렸다.**

파일 8개짜리 프로젝트 기준 한 라운드에서:

| 구간 | 소요 |
|---|---|
| 도구 호출 11회(Glob·Read·Grep) 합계 | **약 5초** |
| thinking + 최종 응답 생성 | **약 42초** |

탐색은 전체의 10%도 안 된다. 지연은 **생성**이 지배하며, 출력 토큰 수에 거의 비례한다. 따라서 digest를 아무리 다듬어도 응답 속도는 안 빨라진다. digest는 여전히 필요하지만 그 이유는 속도가 아니라 정확도다.

실제 손잡이는 `--effort`다. 같은 요청으로 측정한 결과:

| effort | 소요 | 출력 토큰 | 품질 |
|---|---|---|---|
| low | 37~44초 | 2.7~3.1k | 교차 파일 결함을 놓침 |
| medium | 56초 | 4.5k | 기본값과 동등 |
| 미지정(기본) | 58~142초 | 4.5k | — |

low는 빠르지만 값을 잃는다. 실측에서 low는 "취소·환불 시 쿠폰이 이중 사용될 수 있다"는 교차 파일 위험을 놓쳤고, medium은 찾아내 그것을 클라이언트 질문으로 바꿨다. 견적의 근거가 되는 발견이므로 이 차이는 비용이 아니라 손실이다.

**대화 레인은 medium으로 고정한다.** 기본값과 품질이 같으면서 편차가 작아 2~3분 예산 안에 안정적으로 들어온다.

한 가지 더: 지연이 출력 길이에 비례하므로, 출력 계약(§16-2의 JSON)을 늘리면 그대로 응답이 느려진다. 필드를 추가할 때는 속도 예산을 함께 본다.

**16-12. 명세와 코드는 한 저장소 (§6 허브 패턴 개정).**

당초 §6은 프로젝트당 "우리 조직 소유의 허브 repo"를 두고 명세를, 코드는 별도 저장소에 두는 분리 구조였다. 슬라이스 3을 만들며 이걸 단순화했다. **명세는 코드 저장소 안 `specs/`에 산다.** 저장소가 하나면 명세와 코드를 두 곳에 나눌 이유가 없다.

바뀐 것:
- 저장소 = 명세 + 코드. `specs/`가 계약, `src/`가 구현, `CLAUDE.md`·`digest.md`가 규칙·지도.
- Spec PR과 코드 PR은 같은 저장소의 다른 브랜치. `spec/REQ-014`는 `specs/`만, `dev/REQ-014`는 `src/`만 건드린다.
- 슬라이스 4에서 코드 저장소를 따로 만들 필요가 없어졌다.

받아들인 비용:
- 우리 플랫폼 파일(CLAUDE.md, digest.md)이 코드 저장소에 함께 커밋된다. 데모는 우리 소유라 무방하지만, 클라이언트 소유 저장소에서는 "왜 여기 우리 파일이 있나"가 될 수 있다. 당초 분리는 이걸 피하려던 것이었다 — 실제 클라이언트 온보딩 때 다시 판단한다.
- 멀티 repo는 대표 저장소 하나에 `specs/`를 두는 방식으로 미룬다(§6).

## 17. 빌드 순서 (수직 슬라이스)

전체를 한 번에 만들지 않고, 매 슬라이스가 **끝에서 끝까지 관통**하도록 자른다.

**슬라이스 1 — 접수 대화 E2E.** 새 요청 모달 → draft 생성 → 탐색 job → 질문 라운드 → 답변 → 러프 견적 → 티켓 확정. 관통 대상: 웹·DB·큐·락·러너·실제 `claude -p`. 이게 서면 나머지는 같은 뼈대의 반복이다.
**슬라이스 2 — 관리자 결정 큐.** 관리자 로그인, 검토 큐 테이블, 견적 조정·확정, 에스컬레이션 표시.
**슬라이스 3 — Spec과 허브 repo.** 허브 repo 프로비저닝, Spec PR 생성·diff 검토·승인 머지, 명세 화면.
**슬라이스 4 — 구현과 배포.** work/ worktree, 구현 job, 코드 PR, 배포 승인, manual 어댑터. **여기부터 도그푸딩 시작.**
**슬라이스 5 — 운영.** 온보딩 job, 수동 알림 뱃지, 원가 집계 뷰, 서버 배포.
