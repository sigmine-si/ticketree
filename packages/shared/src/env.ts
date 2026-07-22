/**
 * 저장소 루트 .env 로드
 *
 * 패키지가 셋인데 .env는 하나다. Next.js는 자기 패키지 디렉터리의 .env만 읽고,
 * tsx는 아무것도 읽지 않는다. 그래서 루트 .env를 직접 찾아 올린다 —
 * 이게 없으면 러너와 시드가 셸에 손으로 export한 값에 의존하게 된다.
 *
 * 이미 설정된 환경변수는 덮어쓰지 않는다(Node의 loadEnvFile 동작). 서버에서는
 * .env 파일 없이 진짜 환경변수를 쓰므로, 파일이 없으면 조용히 넘어간다.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

let loaded = false

export function loadRootEnv(): void {
  if (loaded) return
  loaded = true

  let dir = process.cwd()
  for (let up = 0; up < 6; up++) {
    const candidate = join(dir, '.env')
    // 루트는 pnpm-workspace.yaml로 알아본다 — 패키지 디렉터리에서 실행돼도 찾아간다
    if (existsSync(candidate) && existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      process.loadEnvFile(candidate)
      return
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
}

loadRootEnv()
