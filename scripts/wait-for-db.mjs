// docker compose up 직후 Postgres가 실제로 연결을 받기까지 몇 초 걸린다.
// healthcheck를 폴링해서 준비될 때까지 기다린다.
import { execSync } from 'node:child_process'

const DEADLINE = Date.now() + 60_000

while (Date.now() < DEADLINE) {
  try {
    const out = execSync(
      "docker inspect -f '{{.State.Health.Status}}' ticketree-db",
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .toString()
      .trim()
    if (out === 'healthy') {
      console.log('db ready')
      process.exit(0)
    }
  } catch {
    // 컨테이너가 아직 안 떴을 수 있다 — 계속 기다린다
  }
  await new Promise((r) => setTimeout(r, 1000))
}

console.error('db did not become healthy within 60s')
process.exit(1)
