/**
 * 개발용 — 직전 라운드의 질문에 답하고 다음 라운드를 돌린다 (--resume 경로).
 *
 *   pnpm --filter @ticketree/runner exec tsx src/dev/try-answer.ts <REQ_NO> "답1" "답2" ...
 *
 * 답을 생략하면 각 질문의 첫 번째 보기를 고른다.
 */
import { and, asc, desc, eq } from 'drizzle-orm'
import {
  changeRequests,
  closeDb,
  createDb,
  createPool,
  enqueueJob,
  estimates,
  messageQuestions,
  messages,
  projects,
} from '@ticketree/shared'
import { claimJob, finishJob } from '../queue.js'
import { runIntakeJob } from '../jobs/intake.js'

const db = createDb()
const pool = createPool()

const reqNo = Number(process.argv[2])
const given = process.argv.slice(3)

const [project] = await db.select().from(projects).where(eq(projects.slug, process.env.PROJECT_SLUG ?? 'cafe-app'))
const [request] = await db
  .select()
  .from(changeRequests)
  .where(and(eq(changeRequests.projectId, project!.id), eq(changeRequests.reqNo, reqNo)))
if (!request) throw new Error(`REQ-${reqNo}를 찾을 수 없습니다`)

const [lastAgentMsg] = await db
  .select()
  .from(messages)
  .where(and(eq(messages.requestId, request.id), eq(messages.role, 'agent')))
  .orderBy(desc(messages.round))
  .limit(1)

const qs = await db
  .select()
  .from(messageQuestions)
  .where(eq(messageQuestions.messageId, lastAgentMsg!.id))
  .orderBy(asc(messageQuestions.idx))

console.log('[답변]')
for (const [i, q] of qs.entries()) {
  const opts = q.options as string[]
  const answer = given[i] ?? opts[0] ?? '네'
  const optionIdx = opts.indexOf(answer)
  await db
    .update(messageQuestions)
    .set({
      answerText: answer,
      answerOptionIdx: optionIdx >= 0 ? optionIdx : null,
      answeredAt: new Date(),
    })
    .where(eq(messageQuestions.id, q.id))
  console.log(` ${i + 1}. ${q.prompt}\n    → ${answer}`)
}

await db.insert(messages).values({
  requestId: request.id,
  round: lastAgentMsg!.round + 1,
  role: 'client',
  content: qs.map((q, i) => `${q.prompt}: ${given[i] ?? (q.options as string[])[0]}`).join('\n'),
})

await enqueueJob(db, {
  projectId: project!.id,
  requestId: request.id,
  kind: 'intake_round',
})

const job = await claimJob(db, pool, 'dev')
if (!job) throw new Error('job을 집지 못했습니다')

const started = Date.now()
try {
  const outcome = await runIntakeJob(db, job)
  await finishJob(db, job.id, outcome)
  console.log(
    `\n=== ${((Date.now() - started) / 1000).toFixed(1)}초 · $${outcome.costUsd?.toFixed(4)} · ${outcome.model} ===\n`,
  )

  const [msg] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.requestId, request.id), eq(messages.role, 'agent')))
    .orderBy(desc(messages.round))
    .limit(1)

  const payload = msg?.payload as Record<string, unknown> | null
  console.log('결과   :', payload?.outcome)
  console.log('메시지 :', msg?.content)

  const nextQs = await db
    .select()
    .from(messageQuestions)
    .where(eq(messageQuestions.messageId, msg!.id))
    .orderBy(asc(messageQuestions.idx))
  if (nextQs.length) {
    console.log('\n[추가 질문]')
    for (const q of nextQs) console.log(` ${q.idx + 1}. ${q.prompt}`)
  }

  if (payload?.summary) {
    console.log('\n[변경 요청서]', JSON.stringify(payload.summary, null, 2))
    const est = await db.select().from(estimates).where(eq(estimates.requestId, request.id))
    console.log('러프 견적 행:', est.length)
  }

  const [after] = await db
    .select({ status: changeRequests.status, title: changeRequests.title })
    .from(changeRequests)
    .where(eq(changeRequests.id, request.id))
  console.log('\n제목:', after?.title, '/ 상태:', after?.status)
} finally {
  await job.release()
  await closeDb()
}
