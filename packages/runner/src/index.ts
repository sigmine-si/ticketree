/**
 * 에이전트 러너 — spec.md §6
 *
 * 설계 원칙: 상태는 DB, 진실은 Git, 러너는 일회용.
 * 웹앱과 직접 통신하지 않는다 — 모든 입출력은 DB를 거친다.
 */
import { randomUUID } from 'node:crypto'
import { changeRequests, closeDb, createDb, createPool, logEvent, pendingNotices } from '@ticketree/shared'
import { eq } from 'drizzle-orm'
import { claimJob, finishJob, requeueJob, type ClaimedJob } from './queue.js'
import { runIntakeJob } from './jobs/intake.js'
import { runEstimationJob } from './jobs/estimation.js'
import { runSpecDraftJob } from './jobs/spec-draft.js'
import { runSpecMergeJob } from './jobs/spec-merge.js'

const RUNNER_ID = `runner-${process.pid}-${randomUUID().slice(0, 8)}`
const POLL_INTERVAL_MS = Number(process.env.RUNNER_POLL_MS ?? 2000)
const MAX_CONCURRENT = Number(process.env.RUNNER_MAX_CONCURRENT ?? 2)
/** 1회 자동 재시도 후 에스컬레이션 (§7) */
const MAX_ATTEMPTS = 2

const db = createDb()
const pool = createPool()

let draining = false
const inFlight = new Set<Promise<void>>()

function log(msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), runner: RUNNER_ID, msg, ...extra }))
}

/** job 실패를 관리자 큐에 올린다. 클라이언트 상태는 그대로 둔다. */
async function flagFailed(requestId: string, jobId: string, error: string): Promise<void> {
  const [row] = await db
    .select({ status: changeRequests.status, flag: changeRequests.flag })
    .from(changeRequests)
    .where(eq(changeRequests.id, requestId))
  if (!row) return

  await db
    .update(changeRequests)
    .set({
      flag: 'failed',
      flagFromStatus: row.flag ? null : row.status,
      yourTurn: false,
      updatedAt: new Date(),
    })
    .where(eq(changeRequests.id, requestId))

  await logEvent(db, requestId, { kind: 'system' }, { jobFailed: jobId, error })
  await db.insert(pendingNotices).values({ requestId, type: 'job_failed' })
}

async function dispatch(job: ClaimedJob): Promise<void> {
  switch (job.kind) {
    case 'exploration':
    case 'intake_round':
      return void (await finishJob(db, job.id, await runIntakeJob(db, job)))
    case 'estimation':
      return void (await finishJob(db, job.id, await runEstimationJob(db, job)))
    case 'spec_draft':
      return void (await finishJob(db, job.id, await runSpecDraftJob(db, job)))
    case 'spec_merge':
      return void (await finishJob(db, job.id, await runSpecMergeJob(db, job)))
    default:
      throw new Error(`job kind '${job.kind}' is not implemented yet`)
  }
}

async function handle(job: ClaimedJob): Promise<void> {
  log('job.start', { jobId: job.id, kind: job.kind, lane: job.lane, attempt: job.attempt })
  try {
    await dispatch(job)
    log('job.done', { jobId: job.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log('job.failed', { jobId: job.id, attempt: job.attempt, error: message })

    if (job.attempt < MAX_ATTEMPTS) {
      await requeueJob(db, job.id, message)
      return
    }

    await finishJob(db, job.id, { status: 'failed', error: message })

    // 재시도까지 실패하면 사람에게 넘긴다 (§7). 단 status는 건드리지 않는다 —
    // job 실패는 클라이언트가 풀 수 있는 문제가 아니므로 관리자에게 가야 하고,
    // 플래그는 stage 위치를 보존한 채 얹힌다.
    if (job.requestId) {
      await flagFailed(job.requestId, job.id, message).catch(() => {})
    }
  } finally {
    // 락을 반드시 푼다 — 안 풀면 해당 프로젝트·레인이 영구 잠긴다
    await job.release()
  }
}

async function tick(): Promise<void> {
  while (!draining && inFlight.size < MAX_CONCURRENT) {
    const job = await claimJob(db, pool, RUNNER_ID)
    if (!job) return

    const p = handle(job).finally(() => inFlight.delete(p))
    inFlight.add(p)
  }
}

async function main(): Promise<void> {
  log('runner.start', { maxConcurrent: MAX_CONCURRENT, pollMs: POLL_INTERVAL_MS })

  while (!draining) {
    try {
      await tick()
    } catch (err) {
      log('tick.error', { error: err instanceof Error ? err.message : String(err) })
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }

  // 드레인: 새 job은 안 집고 진행분만 마친다 (§6)
  log('runner.draining', { inFlight: inFlight.size })
  await Promise.allSettled([...inFlight])
  await closeDb()
  log('runner.stopped')
  process.exit(0)
}

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    if (draining) process.exit(1) // 두 번 누르면 즉시 종료
    draining = true
    log('runner.drain_requested', { signal: sig })
  })
}

main().catch((err) => {
  log('runner.fatal', { error: err instanceof Error ? err.stack : String(err) })
  process.exit(1)
})
