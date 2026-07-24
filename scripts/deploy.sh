#!/usr/bin/env bash
#
# 로컬 기동 스크립트 — db · 웹 · 러너를 한 번에 깨끗하게 띄운다.
#
# 개발용 `pnpm dev`(next dev + tsx watch)는 오래 켜두면 hot-reload가 대량 변경을
# 소화하다 상태가 꼬여 500을 뱉는다(실제로 겪었다). 그래서 이 스크립트는
# **프로덕션 기동**으로 띄운다 — next build 결과를 next start로 서빙하고,
# 러너는 watch 없이 한 번 띄운다. 정적이라 켜둔 채로 안 무너진다.
#
# 하는 일:
#   1. 겹쳐 떠 있는 웹·러너 프로세스를 먼저 정리한다 (좀비·중복 제거)
#   2. Postgres(docker)를 올리고 준비될 때까지 기다린다
#   3. 웹을 빌드하고 3832에, 러너를 백그라운드로 띄운다
#   4. 뜰 때까지 확인하고 상태를 보고한다
#
# 로그: .logs/web.log · .logs/runner.log (tail -f 로 본다)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WEB_PORT=3832
LOG_DIR="$ROOT/.logs"
mkdir -p "$LOG_DIR"

log()  { printf '\033[36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }

# ─────────────────────────────── 1. 기존 프로세스 정리
#
# 웹은 포트로, 러너는 명령줄 경로로 찾는다. 경로를 이 저장소로 한정해
# 다른 프로젝트의 tsx 프로세스를 건드리지 않는다.
log "겹쳐 떠 있는 웹·러너를 정리한다"

# SIGTERM 으로 정중히 내리고, 안 죽으면 SIGKILL. 안 죽은 채로 두면 다음
# build/start 가 포트 충돌로 깨지므로 "정말 죽었는가"까지 확인한다.
stop_pids() {
  local label="$1"; shift
  local pids="$*"
  [ -z "$pids" ] && return 0
  warn "$label 종료: $pids"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  for _ in $(seq 1 10); do
    local alive=""
    for p in $pids; do kill -0 "$p" 2>/dev/null && alive="$alive $p"; done
    [ -z "$alive" ] && return 0
    sleep 0.5
    pids="$alive"
  done
  warn "$label 이 안 내려가 강제 종료:$pids"
  # shellcheck disable=SC2086
  kill -9 $pids 2>/dev/null || true
  sleep 1
}

web_pids="$(lsof -tiTCP:"$WEB_PORT" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ' || true)"
stop_pids "포트 $WEB_PORT 프로세스" "$web_pids"

# runner: 이 저장소의 src/index.ts 를 도는 tsx 프로세스 전부 (경로로 한정)
runner_pids="$(pgrep -f "$ROOT/packages/runner.*src/index.ts" 2>/dev/null || true)"
runner_pids="$runner_pids $(pgrep -f 'tsx.*watch src/index.ts' 2>/dev/null || true)"
runner_pids="$(echo $runner_pids | tr ' ' '\n' | grep -E '^[0-9]+$' | sort -u | tr '\n' ' ' || true)"
stop_pids "기존 러너" "$runner_pids"

# ─────────────────────────────── 2. DB
log "Postgres 를 올린다"
docker compose up -d db >/dev/null
node scripts/wait-for-db.mjs
ok "DB 준비됨 (localhost:5433)"

# 의존성 — worktree 등에서 빠져 있으면 여기서 채운다 (이미 있으면 빠르게 통과)
log "의존성 확인"
pnpm install --prefer-offline >/dev/null 2>&1 || pnpm install
ok "의존성 준비됨"

# ─────────────────────────────── 3. 빌드 + 기동
log "웹을 빌드한다 (1~3분)"
pnpm --filter @ticketree/web build > "$LOG_DIR/build.log" 2>&1 \
  || { warn "빌드 실패 — $LOG_DIR/build.log 를 확인하라"; tail -20 "$LOG_DIR/build.log"; exit 1; }
ok "빌드 완료"

log "웹을 3832 에 띄운다"
( pnpm --filter @ticketree/web start > "$LOG_DIR/web.log" 2>&1 & )

log "러너를 띄운다"
( pnpm --filter @ticketree/runner start > "$LOG_DIR/runner.log" 2>&1 & )

# ─────────────────────────────── 4. 확인
log "뜰 때까지 확인한다"
web_up=""
for _ in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://localhost:$WEB_PORT/admin/login" || true)"
  if [ "$code" = "200" ]; then web_up=1; break; fi
  sleep 1
done

runner_up=""
for _ in $(seq 1 15); do
  if grep -q 'runner.start' "$LOG_DIR/runner.log" 2>/dev/null; then runner_up=1; break; fi
  sleep 1
done

echo
if [ -n "$web_up" ]; then ok "웹      http://localhost:$WEB_PORT  (Tailscale: http://100.112.76.126:$WEB_PORT)"
else warn "웹이 아직 응답하지 않는다 — tail -f $LOG_DIR/web.log"; fi

if [ -n "$runner_up" ]; then ok "러너    떠서 job 을 폴링 중"
else warn "러너 기동 확인 실패 — tail -f $LOG_DIR/runner.log"; fi

echo
echo "로그:   tail -f $LOG_DIR/web.log $LOG_DIR/runner.log"
echo "종료:   $ROOT/scripts/deploy.sh 를 다시 실행하면 정리 후 재기동한다"
