# 코드 지도

pnpm 워크스페이스 모노레포. 세 패키지가 있고, 셋 다 TypeScript다.

```
packages/shared/   상태·정책·스키마 — 웹과 러너가 함께 쓴다
packages/runner/   job 오케스트레이터 — 에이전트를 띄우고 git을 만진다
packages/web/      Next.js — 클라이언트 포털 + 관리자 대시보드
```

## packages/shared

- `src/status.ts` — 상태 머신. 내부 status와 클라이언트 stage(4개)의 분리,
  "지금 클라이언트 차례인가" 판정. 과업내용서용 3단계(`SOW_STAGES`)는 병렬 표로 둔다 —
  4단계와 단어가 하나도 안 겹쳐 한 트랙으로 못 묶는다.
- `src/kind.ts` — 요청의 종류(`change` | `sow`)와 태그 조립(`REQ-001` / `SOW-001`).
  DB를 안 쓰는 순수 모듈이라 클라이언트 컴포넌트도 import한다.
- `src/lanes.ts` — **레인 정책.** job kind → 레인 → 도구·모델·effort·권한.
  read-only 강제가 여기서 시작한다. 프롬프트가 바꿀 수 없는 값들이다.
- `src/project-settings.ts` — 프로젝트마다 다른 값. 지금은 구현 job이 커밋할 수 있는
  경로(`codePaths`)뿐이다.
- `src/agent-io.ts` — 에이전트 출력 계약(zod). 접수·과업내용서·견적·구현 결과 JSON의
  유일한 정의. 범위 판정(`scope`)은 optional이라 계약이 없는 프로젝트는 출력이 안 늘어난다.
- `src/money.ts` — USD 원가 → 원 환산과 원가율. 표시 전용이다.
- `src/db/schema.ts` — drizzle 스키마 14개 테이블.
- `src/db/ops.ts` — `transition`(상태 전이 + 이벤트 기록)과 `enqueueJob`. 상태를 바꾸는
  모든 경로가 여기를 지난다.
- `src/db/client.ts` — 커넥션 풀.
- `src/seed.ts` · `src/seed-greenloop.ts` — 개발용 시드.

## packages/runner

- `src/index.ts` — 루프. job을 하나씩 집어 kind별 핸들러로 보낸다. 실패는 1회 재시도 후
  에스컬레이션.
- `src/queue.ts` — Postgres만으로 만든 큐. 조건부 UPDATE로 클레임하고, 프로젝트·레인
  상호배제는 advisory lock으로 건다.
- `src/git.ts` — git·gh 조작. 브랜치·커밋·PR·머지가 전부 여기 모여 있다.
  **에이전트가 아니라 러너가 한다.**
- `src/agent/claude.ts` — Claude Code headless 래퍼. 에이전트를 띄우는 유일한 지점.
- `src/agent/status-text.ts` — 스트림 이벤트에서 "지금 무엇을 하는 중" 문구를 뽑는다.
- `src/jobs/intake.ts` · `intake-prompt.ts` — 탐색과 접수 대화 라운드.
  `applyOutcome`·`buildResumePrompt`는 과업내용서 대화도 함께 쓴다.
- `src/jobs/sow.ts` · `sow-prompt.ts` — 과업내용서 대화. 여덟 항목이 종료 조건이고,
  제외 범위가 비면 파싱이 실패한다.
- `src/jobs/sow-spec-draft.ts` — 확정된 과업내용서를 고객 저장소의 첫 명세로 옮긴다.
  계약 원문(`specs/contracts/SOW-00N.md`)은 **러너가 직접 쓴다** — 에이전트가 옮겨 적으면
  말이 바뀌는데, 범위 판정이 그 문장을 그대로 인용하기 때문이다.
- `src/jobs/spec-format.ts` — 고객 명세의 파일 형식. 온보딩과 과업내용서가 공유한다.
  웹의 명세 파서가 이 형식을 읽으므로 두 곳에 적으면 한쪽만 고쳐진다.
- `src/jobs/estimation.ts` — 확정 견적 산출과 **범위 판정**. 계약 목록은 러너가 뽑아
  경로를 주고 본문은 에이전트가 Read로 읽는다. 판정 결과는 러너가 사후 검증한다.
- `src/jobs/spec-draft.ts` — 명세 초안과 명세 PR 생성.
- `src/jobs/spec-merge.ts` — 명세 PR 머지. 에이전트를 쓰지 않는다.
  과업내용서면 구현을 등록하지 않고 `sow_active`로 끝낸다.
- `src/jobs/implementation.ts` — 구현. worktree에서 코드를 고치고 코드 PR을 연다.
- `src/jobs/deploy.ts` — 코드 PR 머지. manual 어댑터는 여기까지만 한다.
- `src/jobs/deploy-finalize.ts` — 명세의 "예정" 항목을 정식 항목으로 바꾸고 종결.
- `src/dev/*.ts` — 러너를 띄우지 않고 job 하나만 돌려보는 스크립트.

## packages/web

- `src/app/[slug]/requests/` — 클라이언트 포털. 요청 목록과 요청 상세(대화·견적·승인).
- `src/app/[slug]/sow/` — 과업내용서 목록과 상세. 계약 단위로 쌓인다.
- `src/app/[slug]/spec/` — 클라이언트가 보는 서비스 명세 화면.
- `src/components/QuestionBlock.tsx` — 문답 카드. 접수 대화와 과업내용서 대화가 공유한다.
  두 벌로 두면 갈라진다(실제로 갈라져 있었다).
- `src/app/invite/[token]/` — 초대 링크 + PIN 로그인. 로그인 없이 열리는 유일한
  클라이언트 화면이다. PIN 5회 연속 실패면 잠기고, 관리자 재발급으로만 풀린다.
- `src/app/login/` — 세션 없이 들어온 사람이 도착하는 안내 화면. 여기서 들어갈 수는
  없다 — 문은 초대 링크뿐이다. 환경에 따라 열리는 우회 통로는 없다.
- `src/app/admin/` — 관리자 검토 큐와 요청 상세(명세 diff·승인·배포),
  `admin/invites`는 고객 계정별 초대 링크·PIN 발급.
- `src/app/api/` — 서버 라우트. 클라이언트용과 관리자용이 경로로 갈린다.
- `src/lib/data.ts` — 클라이언트 데이터 접근. 모든 함수가 projectId로 스코프를 건다.
- `src/lib/admin.ts` — 관리자 데이터 접근. 중심 개념은 status가 아니라 "필요한 결정"이다.
- `src/lib/decision.ts` — 상태 → 결정 종류 매핑. DB를 안 쓰는 순수 모듈이라
  클라이언트 컴포넌트도 import한다.
- `src/lib/specs.ts` — 명세 화면이 읽는 마크다운 파서. DB가 아니라 워크스페이스의
  파일을 그대로 읽는다 — 진실은 Git이므로.
- `src/lib/session.ts` — 서명된 세션 쿠키. 클라이언트 세션과 관리자 세션이 별개다.
- `src/lib/invite.ts` — 초대 토큰·PIN의 생성과 해시. node:crypto만 쓴다. 토큰은
  조회해야 하므로 SHA-256, PIN은 6자리뿐이라 salt + scrypt다. DB를 모르는 순수 모듈.

## 주의

- 상태를 바꿀 때 `transition`을 우회하면 이벤트 로그가 끊기고, 클라이언트 타임라인과
  관리자 감사 추적이 동시에 망가진다.
- 레인 정책을 job 쪽에서 덮어쓰지 않는다. 도구 화이트리스트가 무력해진다.
- 명세 화면은 워크스페이스의 파일을 읽으므로, 머지 직후 `syncMain`을 부르지 않으면
  화면이 옛 명세를 보여준다.
- 금액을 truthy로 판정하지 않는다. 계약 범위 안이면 **0원 견적**이 나오는데,
  `amount ? … : '산출 중'`으로 쓰면 0원이 미산출로 보인다. `!= null`로 비교한다.
- `listRequests`의 `kind='change'` 필터가 요청 목록과 과업내용서를 가르는 불변식이다.
  이게 빠지면 두 목록이 섞이고, 4단계 stage가 과업내용서에도 그려진다.
- PIN 연속 실패 횟수는 `users.pin_failed_count`에 있다. 인메모리로 옮기면 프로세스가
  재시작할 때마다 잠금이 풀려 "관리자가 다시 발급해야만 풀린다"가 거짓이 된다.
- 초대 평문(토큰·PIN)은 발급 응답 본문에만 실린다. 주소·리다이렉트·로그에 싣지
  않는다 — 저장된 것은 해시뿐이라 한 번 흘리면 회수할 방법이 없다.
