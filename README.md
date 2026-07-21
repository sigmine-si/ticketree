# Ticket Tree

Spec Driven Development 기반 외주 개발 운영 플랫폼.
클라이언트가 요구사항을 대화로 확정하면 Claude Code 에이전트가 코드를 탐색·구현하고,
관리자가 Spec과 배포를 승인한다.

기획서: [spec.md](spec.md) · 목업: `client-portal-mockup.html`, `admin-dashboard-mockup.html`

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
- [ ] 슬라이스 4 — 구현·배포 (여기부터 도그푸딩)
- [ ] 슬라이스 5 — 운영
