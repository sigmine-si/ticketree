/**
 * 명세 PR 머지 job — spec.md §1
 *
 * 에이전트를 띄우지 않는다. 머지는 비가역적이라 반드시 사람의 승인 뒤에
 * 러너가 직접 실행한다. 이 job이 큐에 있다는 것 자체가 관리자가 승인했다는 뜻이다.
 */
import { and, eq } from 'drizzle-orm'
import {
  changeRequests,
  projects,
  pullRequests,
  specVersions,
  transition,
  type Db,
} from '@ticketree/shared'
import { mergePr, syncMain } from '../git.js'
import type { ClaimedJob, JobOutcome } from '../queue.js'

const SYSTEM = { kind: 'system' as const }

export async function runSpecMergeJob(db: Db, job: ClaimedJob): Promise<JobOutcome> {
  if (!job.requestId) throw new Error('spec_merge job requires a request_id')

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
        eq(pullRequests.kind, 'spec'),
        eq(pullRequests.status, 'open'),
      ),
    )
  if (!pr) throw new Error('머지할 Spec PR이 없습니다')

  await mergePr(project.workspacePath, pr.prNumber)

  // 머지 결과를 로컬 워크스페이스에 반영한다.
  // 명세 화면은 DB가 아니라 이 파일들을 읽으므로(진실은 Git), 여기서 안 당기면
  // 클라이언트가 방금 승인된 변경을 못 본다.
  await syncMain(project.workspacePath)

  await db
    .update(pullRequests)
    .set({ status: 'merged', mergedAt: new Date() })
    .where(eq(pullRequests.id, pr.id))

  // 명세 항목은 아직 "예정"이다 — 실제 반영은 배포 완료 시점이다 (§2)
  await db
    .update(specVersions)
    .set({ status: 'merged', mergedAt: new Date() })
    .where(and(eq(specVersions.requestId, request.id), eq(specVersions.status, 'proposed')))

  await transition(db, request.id, 'queued_dev', SYSTEM, { mergedPr: pr.prNumber })

  return {
    status: 'done',
    result: { prNumber: pr.prNumber, merged: true } as never,
    // 에이전트를 안 썼으므로 원가가 없다
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
  }
}
