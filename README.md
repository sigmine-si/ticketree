# Ticket Tree

Spec Driven Development 기반 외주 개발 운영 플랫폼.
클라이언트가 요구사항을 대화로 확정하면 Claude Code 에이전트가 코드를 탐색·구현하고,
관리자가 Spec과 배포를 승인한다.

기획서: [spec.md](spec.md) · 명세: [specs/features/](specs/features) · 목업: `client-portal-mockup.html`, `admin-dashboard-mockup.html`

`spec.md`는 플랫폼 기획서(내부 문서)이고, `specs/features/*.md`는 지금 유효한 명세다.

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

`.env.example`을 `.env`로 복사한다. 저장소 루트의 `.env` 하나만 쓴다 — 웹·러너·시드가
모두 이 파일을 찾아 올린다(`packages/shared/src/env.ts`). 로컬에서는 `claude` CLI 로그인
상태를 그대로 쓰므로 에이전트 토큰을 따로 넣지 않아도 된다.

포털은 초대 링크 + PIN(`/invite/<token>`), 관리자는 `/admin/login`으로 들어간다.
초대 링크는 `/admin/invites`에서 고객 계정마다 발급한다 — 링크와 PIN은 발급 직후
한 번만 보이고, 저장되는 것은 해시뿐이라 다시 볼 수 없다. PIN을 5회 연속 틀리면 그
링크는 잠기고 재발급으로만 풀린다.

로컬에서도 우회 통로는 없다. 개발 중에 클라이언트 화면을 보려면 `pnpm seed` 후
`/admin/invites`에서 초대 링크를 발급해 그 링크로 들어간다.

### 관리자 로그인 설정

`.env`에 `ADMIN_ID`와 `ADMIN_PASSWORD`를 채우면 `/admin/login`에서 그 한 쌍으로 들어간다.
둘 중 하나라도 비어 있으면 로그인 화면이 열리지 않는다. 자격증명을 통과하기 전에는
`users` 행이 만들어지지 않는다.

## 접수 대화 직접 돌려보기

러너를 띄우지 않고 job 하나만 실행한다.

```bash
pnpm --filter @ticketree/runner exec tsx src/dev/try-intake.ts "원하는 변경 내용"
pnpm --filter @ticketree/runner exec tsx src/dev/try-answer.ts <REQ_NO> "답변1" "답변2"
```

대상 프로젝트는 `PROJECT_SLUG`로 바꾼다 (기본값 `cafe-app`).

```bash
PROJECT_SLUG=ticketree pnpm --filter @ticketree/runner exec tsx src/dev/try-intake.ts "..."
```

## 진행 상황

슬라이스 순서는 [spec.md §17](spec.md) 참조.

- [x] 슬라이스 1 — 접수 대화 (백엔드: 큐·락·에이전트·상태 전이)
- [x] 슬라이스 1 — 접수 대화 (포털 UI)
- [x] 슬라이스 2 — 관리자 결정 큐 (GitHub OAuth, 견적 산출, 이중 게이트)
- [x] 슬라이스 3 — Spec·허브 repo (명세 PR·머지·명세 화면)
- [x] 슬라이스 4 — 구현·배포 (worktree·코드 PR·머지·수동 배포·예정→정식)
- [x] 슬라이스 5 — 운영 (고아 job 회수·알림 뱃지·원가 화면·온보딩 job·프로덕션 빌드)
