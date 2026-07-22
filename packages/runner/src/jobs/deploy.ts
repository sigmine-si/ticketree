/**
 * 배포 job — spec.md §1, §16-6
 *
 * 에이전트를 쓰지 않는다. 배포 승인 뒤 러너가 코드 PR을 머지한다.
 * manual 어댑터는 머지까지만 하고, 실제 배포는 운영자에게 넘긴다.
 */
import { and, eq } from 'drizzle-orm'
import {
  changeRequests,
  pendingNotices,
  projects,
  pullRequests,
  transition,
  type Db,
} from '@ticketree/shared'
import { mergePr, syncMain } from '../git.js'
import type { ClaimedJob, JobOutcome } from '../queue.js'

const SYSTEM = { kind: 'system' as const }

export async function runDeployJob(db: Db, job: ClaimedJob): Promise<JobOutcome> {
  if (!job.requestId) throw new Error('deploy job requires a request_id')

  const [request] = await db
    .select()
    .from(changeRequests)
    .where(eq(changeRequests.id, job.requestId))
  if (!request) throw new Error(`request ${job.requestId} not found`)

  const [project] = await db.select().from(projects).where(eq(projects.id, job.projectId))
  if (!project?.workspacePath) throw new Error(`project ${job.projectId} has no workspace_path`)

  const [pr] = await db
    .select()
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.requestId, request.id),
        eq(pullRequests.kind, 'code'),
        eq(pullRequests.status, 'open'),
      ),
    )
  if (!pr) throw new Error('머지할 코드 PR이 없습니다')

  // 멀티 repo면 repos.yml 의존 순서대로 머지하지만, MVP는 단일 저장소다 (§16-12)
  await mergePr(project.workspacePath, pr.prNumber)
  await syncMain(project.workspacePath)

  await db
    .update(pullRequests)
    .set({ status: 'merged', mergedAt: new Date() })
    .where(eq(pullRequests.id, pr.id))

  if (project.deployAdapter === 'manual') {
    // 머지까지만. 실제 배포는 운영자 몫 (§16-6). 클라이언트에게는 여전히 "개발 완료"로 보인다.
    await transition(db, request.id, 'awaiting_manual_deploy', SYSTEM, { mergedPr: pr.prNumber })
    await db.insert(pendingNotices).values({ requestId: request.id, type: 'manual_deploy_required' })
  } else {
    // vercel 등 자동 어댑터는 후순위 — 지금은 manual만 완전 지원한다
    await transition(db, request.id, 'awaiting_manual_deploy', SYSTEM, {
      mergedPr: pr.prNumber,
      note: 'auto adapter not implemented, treating as manual',
    })
    await db.insert(pendingNotices).values({ requestId: request.id, type: 'manual_deploy_required' })
  }

  return {
    status: 'done',
    result: { prNumber: pr.prNumber, merged: true } as never,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
  }
}
