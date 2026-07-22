/**
 * 배포 완료 처리 — spec.md §2, §3
 *
 * 운영자가 "배포 완료로 표시"를 누르면 돈다. 명세의 "예정" 항목을 정식 항목으로
 * 바꾸고(- [ ] → - [x], 예정 태그 제거) main에 반영한 뒤 요청을 종결한다.
 *
 * 이 flip은 결정적인 텍스트 치환이라 에이전트를 쓰지 않는다. main 직접 커밋 금지는
 * 에이전트에게 건 규칙이고(CLAUDE.md), 플랫폼의 배포 확정은 러너가 한다.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import {
  changeRequests,
  pendingNotices,
  projects,
  specVersions,
  transition,
  type Db,
} from '@ticketree/shared'
import { git, syncMain } from '../git.js'
import type { ClaimedJob, JobOutcome } from '../queue.js'

const SYSTEM = { kind: 'system' as const }

/** `- [ ] (예정 · REQ-002) 문구` → `- [x] 문구`. 다른 REQ의 예정 항목은 건드리지 않는다. */
function flipPending(md: string, reqTag: string): { text: string; flipped: number } {
  let flipped = 0
  const re = new RegExp(
    String.raw`^(\s*-\s*)\[ \]\s*\((?:예정\s*·\s*)?${reqTag}\)\s*(.+)$`,
    'gm',
  )
  const text = md.replace(re, (_m, bullet: string, rest: string) => {
    flipped++
    return `${bullet}[x] ${rest.trim()}`
  })
  return { text, flipped }
}

export async function runDeployFinalizeJob(db: Db, job: ClaimedJob): Promise<JobOutcome> {
  if (!job.requestId) throw new Error('deploy_finalize job requires a request_id')

  const [request] = await db
    .select()
    .from(changeRequests)
    .where(eq(changeRequests.id, job.requestId))
  if (!request?.reqNo) throw new Error('확정되지 않은 요청은 종결하지 않는다')

  const [project] = await db.select().from(projects).where(eq(projects.id, job.projectId))
  if (!project?.workspacePath) throw new Error(`project ${job.projectId} has no workspace_path`)

  const reqTag = `REQ-${String(request.reqNo).padStart(3, '0')}`
  const cwd = project.workspacePath

  // 최신 main에서 시작한다 — 그동안 다른 요청이 머지됐을 수 있다
  await syncMain(cwd)

  const featuresDir = join(cwd, 'specs', 'features')
  let totalFlipped = 0
  for (const name of (await readdir(featuresDir)).filter((n) => n.endsWith('.md'))) {
    const path = join(featuresDir, name)
    const { text, flipped } = flipPending(await readFile(path, 'utf8'), reqTag)
    if (flipped > 0) {
      await writeFile(path, text)
      totalFlipped += flipped
    }
  }

  if (totalFlipped > 0) {
    await git(cwd, 'add', '--', 'specs')
    await git(cwd, 'commit', '-m', `${reqTag} 배포 완료 — 예정 항목 정식 반영`)
    // 플랫폼의 배포 확정 커밋. 에이전트가 아니라 러너가 main에 직접 올린다.
    await git(cwd, 'push', 'origin', 'main')
  }

  await db
    .update(specVersions)
    .set({ version: 'live' })
    .where(and(eq(specVersions.requestId, request.id), eq(specVersions.status, 'merged')))

  await db
    .update(changeRequests)
    .set({ deployedAt: new Date() })
    .where(eq(changeRequests.id, request.id))

  await transition(db, request.id, 'deployed', SYSTEM, { flippedItems: totalFlipped })
  await db.insert(pendingNotices).values({ requestId: request.id, type: 'deployed' })

  return {
    status: 'done',
    result: { flipped: totalFlipped } as never,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
  }
}
