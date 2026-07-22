# 전체 흐름

버전: v1.0 · 마지막 변경 2026-07-22
순서: 0

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

- `spec/REQ-014` — `specs/`만 건드린다
- `dev/REQ-014` — 코드 경로만 건드린다(`projects.settings.codePaths`)
- main 직접 push는 `deploy_finalize`의 예정→정식 치환뿐이다. 결정적 텍스트 치환이라
  에이전트를 쓰지 않는다

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

### 인증

- 클라이언트: 초대링크 + PIN. 프로젝트에 묶인다
- 관리자: GitHub OAuth + `ADMIN_GITHUB_LOGINS` 허용 목록. 목록에 없으면 users 행조차
  만들지 않는다. 프로젝트에 묶이지 않는다
- 두 세션은 별개 쿠키다. 서명된 쿠키 하나로 검증한다

### 원가

job의 result 이벤트에서 `total_cost_usd`와 modelUsage를 그대로 쌓는다.
캐시 토큰(cache_creation + cache_read)을 입력에 합산한다 — 원가의 대부분이 여기서 나온다.
이 금액은 **API 환산가이지 구독 실지출이 아니다.**

## 변경 이력

- v1.0 2026-07-22 전체 흐름 최초 정의
