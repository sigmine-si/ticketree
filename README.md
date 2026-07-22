# Ticket Tree

Spec Driven Development 기반 외주 개발 운영 플랫폼.
클라이언트가 요구사항을 대화로 확정하면 Claude Code 에이전트가 코드를 탐색·구현하고,
관리자가 Spec과 배포를 승인한다.

기획서: [spec.md](spec.md) · 명세: [specs/features/](specs/features) · 목업: `client-portal-mockup.html`, `admin-dashboard-mockup.html`

`spec.md`는 플랫폼 기획서(내부 문서)이고, `specs/features/*.md`는 이 저장소가
플랫폼의 관리 대상 프로젝트로서 갖는 클라이언트용 명세다. 아래 도그푸딩 참조.

## 구조

```
packages/
├── shared/   상태 머신, 레인 정책, DB 스키마, 공용 ops
├── runner/   job 오케스트레이터 — claude -p 실행, 큐, 락
└── web/      Next.js — 클라이언트 포털 + 관리자 대시보드
```

설계 원칙: **상태는 DB, 진실은 Git, 러너는 일회용.**
웹앱과 러너는 직접 통신하지 않는다 — 모든 상태는 DB를 거친다.

## 로컬 실행

```bash
pnpm install
pnpm db:up        # Postgres (docker, :5433)
pnpm db:push      # 스키마 반영
pnpm seed         # 예제 프로젝트(로컬 전용) 생성
pnpm seed:demo    # 데모 프로젝트 '그린루프 몰' — 허브 repo를 GitHub에 올린다
pnpm dev          # web + runner
```

`.env.example`을 `.env`로 복사한다. 로컬에서는 `claude` CLI 로그인 상태를 그대로 쓰므로
에이전트 토큰을 따로 넣지 않아도 된다.

포털은 `/dev-login`, 관리자는 `/admin/login`으로 들어간다. 둘 다 로컬 전용 우회이며
실제 인증(초대링크+PIN / GitHub OAuth)은 세션 레이어 위에 이미 붙어 있다.

### 관리자 GitHub OAuth 설정 (선택)

GitHub → Settings → Developer settings → OAuth Apps에서 앱을 만들고
Authorization callback URL을 `http://localhost:3000/api/auth/github/callback`으로 둔 뒤,
`.env`에 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `ADMIN_GITHUB_LOGINS`를 채운다.
허용 목록에 없는 계정은 users 행조차 만들어지지 않는다.

## 도그푸딩 — ticketree로 ticketree를 개발한다

이 저장소는 플랫폼이면서 동시에 플랫폼이 관리하는 프로젝트다 (§16-8).

```bash
pnpm seed:self    # 자기 자신을 프로젝트로 등록한다
```

`workspaces/ticketree/`에 **별도 클론**을 만든다. 개발 중인 이 디렉터리를 워크스페이스로
쓰지 않는다 — 러너가 `git reset --hard origin/main`을 걸기 때문에 커밋 안 한 변경이 날아간다.

돌리는 법:

1. `pnpm dev`로 웹과 러너를 띄운다
2. `/dev-login`에서 '시그마인 / Ticket Tree'로 들어가 요청을 낸다
3. `/admin`에서 명세와 배포를 승인한다
4. 머지된 변경은 `git pull`로 이 디렉터리에 가져온다 — 워크스페이스 클론과는 별개다

주의할 점:

- 명세 화면과 에이전트가 읽는 것은 **origin/main**이다. `specs/`·`CLAUDE.md`·`digest.md`를
  고쳤으면 push해야 도그푸딩에 반영된다.
- 구현 job이 커밋할 수 있는 경로는 `projects.settings.codePaths`로 정한다. 이 프로젝트는
  모노레포라 `packages/`·`scripts/`이고, 단일 저장소 프로젝트는 기본값 `src/`다.
- 러너가 자기 자신의 코드를 고쳐도 실행 중인 러너는 영향받지 않는다. 작업은 별도
  worktree에서 일어나고, 반영은 `git pull` + 재시작 시점에 일어난다.

## 접수 대화 직접 돌려보기

러너를 띄우지 않고 job 하나만 실행한다.

```bash
pnpm --filter @ticketree/runner exec tsx src/dev/try-intake.ts "원하는 변경 내용"
pnpm --filter @ticketree/runner exec tsx src/dev/try-answer.ts <REQ_NO> "답변1" "답변2"
```

## 진행 상황

슬라이스 순서는 [spec.md §17](spec.md) 참조.

- [x] 슬라이스 1 — 접수 대화 (백엔드: 큐·락·에이전트·상태 전이)
- [x] 슬라이스 1 — 접수 대화 (포털 UI)
- [x] 슬라이스 2 — 관리자 결정 큐 (GitHub OAuth, 견적 산출, 이중 게이트)
- [x] 슬라이스 3 — Spec·허브 repo (명세 PR·머지·명세 화면)
- [x] 슬라이스 4 — 구현·배포 (worktree·코드 PR·머지·수동 배포·예정→정식)
- [x] 도그푸딩 준비 — 자기 자신을 프로젝트로 등록 (`pnpm seed:self`)
- [ ] 슬라이스 5 — 운영 (온보딩 job·알림 뱃지·원가 뷰·서버 배포)
