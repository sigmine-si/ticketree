/**
 * 상태 전이와 job 등록 — spec.md §7, §16-4
 *
 * 웹과 러너가 공유한다. 모든 상태 전이는 반드시 여기를 지나서
 * request_events에 흔적을 남긴다. 직접 UPDATE 하지 않는다.
 */
import { eq, sql } from 'drizzle-orm'
import type { Db } from './client.js'
import { changeRequests, jobs, projects, requestEvents } from './schema.js'
import { isClientTurn, type RequestStatus } from '../status.js'
import { LANE_OF_JOB, type JobKind } from '../lanes.js'

export type ActorKind = 'client' | 'admin' | 'agent' | 'system'

export interface Actor {
  kind: ActorKind
  id?: string
}

/**
 * 상태를 옮기고 이벤트를 남긴다.
 * yourTurn(앰버 플래그)은 status에서 파생하므로 여기서 함께 갱신한다.
 */
export async function transition(
  db: Db,
  requestId: string,
  to: RequestStatus,
  actor: Actor,
  meta: Record<string, unknown> = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ status: changeRequests.status })
      .from(changeRequests)
      .where(eq(changeRequests.id, requestId))
      .for('update')

    if (!before) throw new Error(`change_request ${requestId} not found`)
    if (before.status === to) return // 재진입 방어 — 같은 전이를 두 번 기록하지 않는다

    await tx
      .update(changeRequests)
      .set({ status: to, yourTurn: isClientTurn(to), updatedAt: new Date() })
      .where(eq(changeRequests.id, requestId))

    await tx.insert(requestEvents).values({
      requestId,
      fromStatus: before.status,
      toStatus: to,
      actorKind: actor.kind,
      actorId: actor.id ?? null,
      meta,
    })
  })
}

/** 상태 전이 없이 사건만 기록한다 (답변 도착, job 실패 등). */
export async function logEvent(
  db: Db,
  requestId: string,
  actor: Actor,
  meta: Record<string, unknown>,
): Promise<void> {
  await db.insert(requestEvents).values({
    requestId,
    fromStatus: null,
    toStatus: null,
    actorKind: actor.kind,
    actorId: actor.id ?? null,
    meta,
  })
}

export interface EnqueueInput {
  projectId: string
  requestId?: string
  kind: JobKind
  sessionRef?: string
  worktreePath?: string
}

/** lane은 job kind에서 파생한다 — 호출자가 정하지 않는다 (§16-9). */
export async function enqueueJob(db: Db, input: EnqueueInput): Promise<string> {
  const [row] = await db
    .insert(jobs)
    .values({
      projectId: input.projectId,
      requestId: input.requestId ?? null,
      kind: input.kind,
      lane: LANE_OF_JOB[input.kind],
      sessionRef: input.sessionRef ?? null,
      worktreePath: input.worktreePath ?? null,
      status: 'queued',
    })
    .returning({ id: jobs.id })
  return row!.id
}

/**
 * §16-4 — 프로젝트 내 일련번호를 원자적으로 소비한다.
 * max(req_no)+1은 동시 확정에서 깨지므로 쓰지 않는다.
 */
export async function allocateReqNo(db: Db, projectId: string): Promise<number> {
  const [row] = await db
    .update(projects)
    .set({ nextReqNo: sql`${projects.nextReqNo} + 1` })
    .where(eq(projects.id, projectId))
    .returning({ next: projects.nextReqNo })
  if (!row) throw new Error(`project ${projectId} not found`)
  // RETURNING은 갱신 후 값이므로 방금 소비한 번호는 하나 앞이다
  return row.next - 1
}
