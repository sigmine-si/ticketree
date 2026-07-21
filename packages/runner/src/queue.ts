/**
 * job 큐와 락 — spec.md §16-5
 *
 * 별도 큐 인프라를 두지 않는다. Postgres만으로 해결한다.
 *  - job 클레임: 조건부 UPDATE (경합 시 0 rows → 다음 후보)
 *  - 프로젝트·레인 상호배제: 세션 레벨 advisory lock
 *
 * job 실행은 수 분 걸리므로 트랜잭션을 붙들 수 없다. 그래서 xact 락이 아니라
 * 전용 커넥션에 세션 락을 잡고, job이 끝나면 명시적으로 푼다.
 */
import type pg from 'pg'
import { and, asc, eq } from 'drizzle-orm'
import type { Db, JobKind, JobStatus, Lane } from '@ticketree/shared'
import { jobs } from '@ticketree/shared'

export interface ClaimedJob {
  id: string
  projectId: string
  requestId: string | null
  kind: JobKind
  lane: Lane
  attempt: number
  sessionRef: string | null
  worktreePath: string | null
  /** 반드시 호출해야 한다 — 안 부르면 해당 프로젝트·레인이 영구 잠긴다. */
  release: () => Promise<void>
}

function lockKey(projectId: string, lane: Lane): string {
  return `${projectId}:${lane}`
}

/**
 * 후보를 순서대로 훑으며 락을 잡을 수 있는 첫 job을 가져온다.
 * 락이 안 잡히는 job은 건너뛴다 — 같은 프로젝트의 다른 요청이 진행 중이라는 뜻이므로
 * 큐 전체가 막히지 않고 다음 프로젝트로 넘어간다.
 */
export async function claimJob(
  db: Db,
  pool: pg.Pool,
  runnerId: string,
): Promise<ClaimedJob | null> {
  const candidates = await db
    .select({
      id: jobs.id,
      projectId: jobs.projectId,
      requestId: jobs.requestId,
      kind: jobs.kind,
      lane: jobs.lane,
      attempt: jobs.attempt,
      sessionRef: jobs.sessionRef,
      worktreePath: jobs.worktreePath,
    })
    .from(jobs)
    .where(eq(jobs.status, 'queued'))
    .orderBy(asc(jobs.queuedAt))
    .limit(20)

  for (const c of candidates) {
    const lane = c.lane as Lane
    const client = await pool.connect()
    let locked = false
    try {
      const res = await client.query<{ ok: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS ok',
        [lockKey(c.projectId, lane)],
      )
      locked = res.rows[0]?.ok === true
      if (!locked) {
        client.release()
        continue
      }

      // 락은 잡았지만 다른 러너가 이미 이 job을 가져갔을 수 있다.
      // status='queued' 조건이 그 경합을 막는다.
      const updated = await db
        .update(jobs)
        .set({
          status: 'running',
          claimedBy: runnerId,
          startedAt: new Date(),
          attempt: c.attempt + 1,
        })
        .where(and(eq(jobs.id, c.id), eq(jobs.status, 'queued')))
        .returning({ id: jobs.id })

      if (updated.length === 0) {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [
          lockKey(c.projectId, lane),
        ])
        client.release()
        continue
      }

      let released = false
      return {
        id: c.id,
        projectId: c.projectId,
        requestId: c.requestId,
        kind: c.kind as JobKind,
        lane,
        attempt: c.attempt + 1,
        sessionRef: c.sessionRef,
        worktreePath: c.worktreePath,
        release: async () => {
          if (released) return
          released = true
          try {
            await client.query('SELECT pg_advisory_unlock(hashtext($1))', [
              lockKey(c.projectId, lane),
            ])
          } finally {
            client.release()
          }
        },
      }
    } catch (err) {
      if (locked) {
        await client
          .query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey(c.projectId, lane)])
          .catch(() => {})
      }
      client.release()
      throw err
    }
  }

  return null
}

/** 버퍼링 상태 문구 갱신 — SSE가 이 컬럼을 릴레이한다 (§2). */
export async function setStatusText(db: Db, jobId: string, text: string): Promise<void> {
  await db.update(jobs).set({ statusText: text }).where(eq(jobs.id, jobId))
}

export interface JobOutcome {
  status: Extract<JobStatus, 'done' | 'failed'>
  result?: unknown
  error?: string
  tokensIn?: number
  tokensOut?: number
  costUsd?: number
  model?: string
}

export async function finishJob(db: Db, jobId: string, outcome: JobOutcome): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: outcome.status,
      result: (outcome.result ?? null) as never,
      error: outcome.error ?? null,
      tokensIn: outcome.tokensIn ?? 0,
      tokensOut: outcome.tokensOut ?? 0,
      costUsd: outcome.costUsd !== undefined ? String(outcome.costUsd) : null,
      model: outcome.model ?? null,
      finishedAt: new Date(),
      statusText: null,
    })
    .where(eq(jobs.id, jobId))
}

/** 1회 자동 재시도 후 에스컬레이션 (§7). */
export async function requeueJob(db: Db, jobId: string, error: string): Promise<void> {
  await db
    .update(jobs)
    .set({ status: 'queued', claimedBy: null, startedAt: null, error, statusText: null })
    .where(eq(jobs.id, jobId))
}
