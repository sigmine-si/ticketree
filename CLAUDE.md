# Ticket Tree

Spec Driven Development 기반 외주 개발 운영 플랫폼. 이 저장소는 플랫폼 자신의 코드다.

**이 저장소에는 명세를 두지 않는다.** 명세는 이 플랫폼이 고객 프로젝트를 위해
만들어주는 산출물이지, 플랫폼 자신이 따르는 문서가 아니다. 여기서 유효한 것은
사용자의 지시와 코드다. `spec.md`는 착수 시점의 기획서(내부 참고 문서)일 뿐이고,
지금 동작을 정하는 것은 코드다.

## 플랫폼 규칙

- 무엇을 만들지는 사용자가 정한다. 문서를 근거로 요청을 막지 않는다.
- 요청이 모호하면 추측하지 말고 물어본다.
- main 브랜치에 직접 push하지 않는다. 변경은 반드시 브랜치와 PR로 낸다.
- 탐색 결과는 파일 경로와 함께 보고한다.

고객 프로젝트에 써줄 명세의 형식은 러너의 job 프롬프트가 가진다
(`packages/runner/src/jobs/onboarding.ts`, `spec-draft.ts`). 그 형식은 고객
저장소에만 적용되고, 이 저장소에는 적용되지 않는다.

## 코드 규칙

- **상태는 DB, 진실은 Git, 러너는 일회용.** 웹앱과 러너는 직접 통신하지 않는다 —
  모든 상태는 DB를 거친다.
- 상태 전이는 `packages/shared/src/db/ops.ts`의 `transition`을 거친다.
  `change_requests`를 직접 UPDATE 하지 않는다 — 이벤트 로그가 끊긴다.
- 에이전트 실행은 `packages/runner/src/agent/claude.ts` 하나뿐이다. 다른 곳에서
  프로세스를 띄우지 않는다. 도구·권한·모델은 전부 `packages/shared/src/lanes.ts`의
  레인 정책에서 나온다 (§16-9).
- `--dangerously-skip-permissions`를 어디에도 두지 않는다.
- 머지·배포처럼 비가역적인 동작은 에이전트가 닿는 경로에 두지 않는다. 러너가 한다.
- 웹의 데이터 접근은 `packages/web/src/lib/data.ts`(클라이언트)와 `lib/admin.ts`(관리자)를
  거친다. 페이지·라우트가 drizzle을 직접 부르지 않는다 — 프로젝트 스코프를 빠뜨리게 된다.
- 클라이언트에게 보이는 문장에 내부 status를 노출하지 않는다. `packages/shared/src/status.ts`의
  4단계 stage만 보여준다.

## 확인 방법

worktree에는 `node_modules`가 없다. 타입체크가 필요하면 루트에서 `pnpm install` 후
`pnpm typecheck`를 돌린다(설치에 1~2분 걸린다). DB가 필요한 검증은 이 단계에서 하지 않는다 —
확인할 지점을 결과의 notes에 적어 사람에게 넘긴다.
