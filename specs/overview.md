# 전체 흐름

버전: v1.2 · 마지막 변경 2026-07-22

## 이렇게 동작해요

- [x] 요청 하나는 접수됨 → 개발 중 → 개발 완료 → 배포 완료 네 단계를 지난다
- [x] 각 단계에서 지금 누구 차례인지(내 차례인지, 우리 쪽 차례인지)가 표시된다
- [x] 클라이언트가 승인해야 개발이 시작되고, 관리자가 승인해야 배포된다
- [x] 요청은 대화로 확정되고, 확정된 내용은 먼저 명세에 반영된 뒤 코드가 바뀐다
- [x] 무슨 일이 언제 있었는지가 요청마다 시간순으로 남는다

## 알려진 제약

- 알림이 없다. 화면을 직접 열어봐야 진행 상황을 안다
- 요청을 보류하거나 취소하는 버튼이 화면에 없다

## 구현 규칙 (내부)

### 설계 원칙

**상태는 DB, 진실은 Git, 러너는 일회용.**
웹앱과 러너는 직접 통신하지 않는다 — 모든 입출력은 DB를 거친다. 러너를 죽였다 살려도
DB만 살아 있으면 이어서 돈다.

### 구성 요소

| 조각 | 하는 일 |
|---|---|
| 웹 (Next.js) | 클라이언트 포털 + 관리자 대시보드. DB를 읽고 쓰고, 워크스페이스의 명세 파일을 읽는다 |
| 러너 | job을 하나씩 집어 에이전트를 띄우고 git을 만진다. 웹과 대화하지 않는다 |
| Postgres | 유일한 상태 저장소. 큐와 락도 여기서 해결한다(별도 큐 인프라 없음) |
| 워크스페이스 | 프로젝트 저장소의 클론. 웹과 러너가 같은 파일시스템을 본다 |
| claude CLI | 에이전트. headless(`-p --output-format stream-json`)로만 띄운다 |

### 프로젝트 저장소의 구조

명세와 코드가 한 저장소에 산다.

- `specs/features/*.md` — 계약과 설계. 이 문서들이 유일한 진실이다
- `src/` 또는 `packages/` — 구현
- `CLAUDE.md` — 에이전트가 이 저장소에서 지킬 규칙
- `digest.md` — 코드 지도(무엇이 어디에 있나)
- `work/{REQ}/` — 구현용 worktree. 커밋하지 않는다

### 요청의 상태

클라이언트에게 보이는 stage 4개와 내부 status 12개를 분리한다.

| stage (클라이언트) | status (내부) |
|---|---|
| (비노출) | `draft` — 접수 대화 중, 확정 전 |
| 접수됨 | `submitted` `queued_exploration` `exploring` `awaiting_client` `estimating` `quote_ready` |
| 개발 중 | `client_approved` `queued_dev` `developing` |
| 개발 완료 | `in_review` `awaiting_manual_deploy` |
| 배포 완료 | `deployed` (종결) |

루프가 둘 있다: `awaiting_client → exploring`(답변이 재탐색을 부를 때),
`in_review → developing`(검수 수정).

**어느 기능이 어떤 전이를 수행하는지는 각 기능 명세가 소유한다.** 여기는 상태의 목록과
클라이언트에게 어떻게 보이는지까지만 정한다.

횡단 플래그는 stage 위치를 보존한 채 얹힌다 — `escalated`(관리자 답변 대기),
`failed`(1회 자동 재시도 후 에스컬레이션), `on_hold`, `cancelled`.

**모든 전이는 `transition`을 지나 request_events에 기록된다.** 직접 UPDATE 하지 않는다 —
클라이언트 타임라인·감사 추적·단계별 소요 분석이 전부 이 로그에서 나온다.

### job과 레인

job 종류가 레인을 정하고, 레인이 도구·모델·권한을 정한다. **프롬프트가 이걸 바꿀 수 없다.**

| 레인 | job | cwd | 도구 | 모델 | effort |
|---|---|---|---|---|---|
| chat | exploration · intake_round · estimation | 저장소 루트 | Read·Grep·Glob | Sonnet | medium |
| spec | spec_draft | 저장소 루트 | + Edit·Write | Sonnet | medium |
| work | implementation | `work/{REQ}/` | 전체 | Opus | high |

`spec_merge` · `deploy` · `deploy_finalize`는 에이전트를 띄우지 않는다. 비가역적 동작이라
러너가 직접 한다. `--dangerously-skip-permissions`는 코드 어디에도 두지 않는다.

### 한 요청이 지나는 job의 순서

```
새 요청 → exploration → (intake_round ⇄ 클라이언트 답변)* → 티켓 확정
        → estimation → 클라이언트 견적 승인
        → spec_draft → 명세 PR → 관리자 승인 → spec_merge
        → implementation → 코드 PR → 관리자 승인 → deploy
        → (수동 배포) → deploy_finalize → 종결
```

### 큐와 락

- job 클레임: 조건부 UPDATE(경합 시 0 rows → 다음 후보). 별도 락 테이블을 두지 않는다
- 프로젝트·레인 상호배제: `pg_advisory_lock(hashtext(project_id || ':' || lane))`.
  job이 수 분 걸리므로 트랜잭션을 붙들 수 없어 전용 커넥션에 세션 락을 잡는다
- req_no 채번: `UPDATE projects SET next_req_no = next_req_no + 1 RETURNING`.
  `max(req_no)+1`은 경합에서 깨지므로 쓰지 않는다

### 브랜치

브랜치 규칙은 그 브랜치를 만드는 기능이 소유한다 —
명세 PR은 [명세 검토와 승인](features/spec-review.md), 코드 PR과 배포는
[개발과 배포](features/build.md).

### 데이터

| 테이블 | 역할 |
|---|---|
| projects · repos | 프로젝트와 저장소. `settings.codePaths`가 커밋 허용 경로 |
| change_requests | 요청 한 건. status·flag·your_turn |
| messages · message_questions | 접수 대화. 질문 단위로 쪼개 답변률을 집계한다 |
| jobs | 큐이자 계측 기록(토큰·원가·소요·status_text) |
| agent_sessions | `--resume`용 세션 id. 턴 사이에 자원을 점유하지 않는다 |
| estimates | 러프/확정 견적, 작업 분해, 위험 |
| spec_versions · pull_requests | 명세 버전과 PR(spec/code) |
| request_events | 모든 상태 전이 |
| pending_notices | 알려야 할 일 (읽는 화면은 아직 없음) |

### 주소 규약

클라이언트 화면 주소에는 프로젝트가 들어간다. 링크가 자기 자신을 설명해야
관리자가 복사해 클라이언트에게 그대로 보낼 수 있다.

```
/                            세션을 보고 갈라준다 (클라이언트 → 요청 목록, 관리자 → 큐)
/{slug}                      → /{slug}/requests
/{slug}/requests             요청 목록
/{slug}/requests/{reqNo}     요청 상세
/{slug}/spec                 서비스 명세

/admin                       결정 큐 — 여러 프로젝트를 한 판에 보므로 slug가 없다
/admin/{slug}/requests/{id}  검토 상세
/api/...                     데이터 주고받는 뒷단. 쿠키로 이미 프로젝트가 갈리고
                             북마크할 주소가 아니라 slug를 넣지 않는다
```

`/admin`·`/dev-login`·`/api`는 고정 이름이라 `{slug}`보다 먼저 잡힌다.

**주소의 slug는 권한이 아니라 선택이다.** 접근 권한은 여전히 쿠키가 정한다.
클라이언트 화면은 전부 이 판정을 첫 줄에서 지난다 — 지나지 않는 경로가 생기면
그 화면만 스코프가 빠진다.

| 상황 | 결과 |
|---|---|
| 세션 없음 | 로그인 화면으로 |
| 없는 slug | 404 |
| 클라이언트 · 자기 프로젝트 | 통과. 버튼 다 보임 |
| 클라이언트 · 남의 프로젝트 | **404**. 403이 아니다 — 있다는 사실조차 알리지 않는다 |
| 관리자 · 아무 프로젝트 | 통과하되 읽기만. 답변·확정·견적 승인 버튼을 숨긴다 |

관리자가 클라이언트 대신 승인하면 "누가 승인했나"가 기록에서 흐려진다. 그래서 읽기만이다.
버튼을 숨기는 건 정직함이고, 실제 차단은 클라이언트 API가 관리자 쿠키를 거절하는 데서 온다.

### 인증

클라이언트 세션과 관리자 세션은 별개 쿠키다. 각각의 로그인 방식은
[요청 접수와 대화](features/intake.md)와 [관리자 검토 큐](features/admin.md)가 소유한다.

### 원가

계측 방식과 표기 규칙은 [견적과 승인](features/estimate.md)이 소유한다.

### 미해결

- **(미정) 프로덕션 빌드가 깨져 있다.** `next build`가 404·500을 프리렌더하다
  "`<Html>` should not be imported outside of pages/_document"로 죽는다. app 라우터만
  쓰고 pages 디렉터리도 next/document import도 없으며, react·react-dom·next 버전도
  일치한다. `not-found.tsx`·`global-error.tsx`를 넣어도 같다(Next 15.5.20).
  **로컬 개발만 가능하고 서버 배포는 이 문제부터 풀어야 한다.**
- **(미정) 러너가 재시작되면 실행 중이던 job이 running으로 남고 아무도 줍지 않는다.**
  `tsx watch`가 파일 변경으로 재시작할 때 실제로 발생했다. 지금은 사람이 DB에서
  재등록해야 한다.

## 변경 이력

- v1.2 2026-07-22 주소 규약 신설 — 클라이언트 화면 주소에 프로젝트가 들어간다
- v1.1 2026-07-22 제품 정의를 product.md로 분리하고, 기능이 소유한 사실을 링크로 대체
- v1.0 2026-07-22 전체 흐름 최초 정의
