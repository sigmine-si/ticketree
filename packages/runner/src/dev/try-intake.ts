/**
 * 개발용 — 접수 대화 한 바퀴를 실제로 돌려본다.
 *
 *   pnpm --filter @ticketree/runner exec tsx src/dev/try-intake.ts "요청 내용"
 *
 * 러너를 따로 띄우지 않고 job 하나를 직접 실행한다.
 */
import { and, asc, desc, eq } from 'drizzle-orm'
import {
  allocateReqNo,
  changeRequests,
  closeDb,
  createDb,
  createPool,
  enqueueJob,
  messageQuestions,
  messages,
  projects,
  users,
} from '@ticketree/shared'
import { claimJob, finishJob } from '../queue.js'
import { runIntakeJob } from '../jobs/intake.js'

const db = createDb()
const pool = createPool()

const toBe = process.argv[2] ?? '음료가 준비되면 손님이 알림을 받았으면 좋겠어요.'
const asIs = process.argv[3] ?? null

const [project] = await db.select().from(projects).where(eq(projects.slug, 'cafe-app'))
if (!project) throw new Error('seed를 먼저 실행하세요')

const [client] = await db
  .select()
  .from(users)
  .where(and(eq(users.projectId, project.id), eq(users.kind, 'client')))

const reqNo = await allocateReqNo(db, project.id)
const [request] = await db
  .insert(changeRequests)
  .values({
    projectId: project.id,
    reqNo,
    toBe,
    asIs,
    urgency: 'this_week',
    status: 'draft',
    createdBy: client?.id ?? null,
  })
  .returning({ id: changeRequests.id })

await db.insert(messages).values({
  requestId: request!.id,
  round: 0,
  role: 'client',
  content: toBe,
})

await enqueueJob(db, { projectId: project.id, requestId: request!.id, kind: 'exploration' })
console.log(`REQ-${String(reqNo).padStart(3, '0')} 생성, 탐색 job 등록됨`)

const job = await claimJob(db, pool, 'dev')
if (!job) throw new Error('job을 집지 못했습니다')

const started = Date.now()
try {
  const outcome = await runIntakeJob(db, job)
  await finishJob(db, job.id, outcome)
  console.log(`\n=== ${((Date.now() - started) / 1000).toFixed(1)}초 · $${outcome.costUsd?.toFixed(4)} · in ${outcome.tokensIn} / out ${outcome.tokensOut} ===\n`)

  const [msg] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.requestId, request!.id), eq(messages.role, 'agent')))
    .orderBy(desc(messages.round))
    .limit(1)

  const payload = msg?.payload as Record<string, unknown> | null
  console.log('제목    :', payload?.title)
  console.log('결과    :', payload?.outcome)
  console.log('메시지  :', msg?.content)
  console.log('확인파일:', (payload?.files as string[] | undefined)?.join(', '))
  console.log('남은것  :', (payload?.remaining as string[] | undefined)?.join(' / '))
  console.log('\n[내부 탐색 노트]\n' + payload?.notes)

  const qs = await db
    .select()
    .from(messageQuestions)
    .where(eq(messageQuestions.messageId, msg!.id))
    .orderBy(asc(messageQuestions.idx))
  if (qs.length) {
    console.log('\n[질문]')
    for (const q of qs) {
      console.log(` ${q.idx + 1}. ${q.prompt}`)
      const opts = q.options as string[]
      if (opts.length) console.log(`    보기: ${opts.join(' | ')}`)
    }
  }
  if (payload?.summary) console.log('\n[요약]', JSON.stringify(payload.summary, null, 2))

  const [after] = await db
    .select({ status: changeRequests.status, title: changeRequests.title })
    .from(changeRequests)
    .where(eq(changeRequests.id, request!.id))
  console.log('\n요청 상태:', after?.status)
} finally {
  await job.release()
  await closeDb()
}
