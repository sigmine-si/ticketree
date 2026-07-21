/**
 * 개발용 — 한 프로젝트에서 접수 대화를 끝까지 밀어본다.
 *
 *   tsx src/dev/try-flow.ts <project-slug> "TO-BE" ["AS-IS"]
 *
 * 질문이 오면 첫 번째 보기로 자동 답하며 ready에 닿을 때까지 반복한다.
 * 러너를 띄우지 않고 job을 직접 실행하므로, 러너는 꺼두고 쓴다.
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
  type IntakeResult,
} from '@ticketree/shared'
import { claimJob, finishJob } from '../queue.js'
import { runIntakeJob } from '../jobs/intake.js'

const db = createDb()
const pool = createPool()

const slug = process.argv[2] ?? 'greenloop-mall'
const toBe = process.argv[3] ?? ''
const asIs = process.argv[4] ?? null
if (!toBe) throw new Error('TO-BE를 인자로 주세요')

const [project] = await db.select().from(projects).where(eq(projects.slug, slug))
if (!project) throw new Error(`프로젝트 ${slug}를 찾을 수 없습니다`)
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
  content: asIs ? `지금: ${asIs}\n\n${toBe}` : toBe,
})
await enqueueJob(db, { projectId: project.id, requestId: request!.id, kind: 'exploration' })
console.log(`REQ-${String(reqNo).padStart(3, '0')} 생성`)

async function pump(): Promise<IntakeResult | null> {
  const job = await claimJob(db, pool, 'dev-flow')
  if (!job) return null
  const started = Date.now()
  try {
    const outcome = await runIntakeJob(db, job)
    await finishJob(db, job.id, outcome)
    console.log(`  ${job.kind} — ${((Date.now() - started) / 1000).toFixed(0)}초`)
  } finally {
    await job.release()
  }
  const [msg] = await db
    .select({ payload: messages.payload })
    .from(messages)
    .where(and(eq(messages.requestId, request!.id), eq(messages.role, 'agent')))
    .orderBy(desc(messages.round))
    .limit(1)
  return (msg?.payload ?? null) as IntakeResult | null
}

for (let round = 1; round <= 6; round++) {
  const result = await pump()
  if (!result) break
  console.log(`라운드 ${round}: ${result.outcome}`)

  if (result.outcome === 'ready') {
    console.log(`\n제목: ${result.title}`)
    console.log(`범위:\n${result.summary?.scope.map((s) => `  - ${s}`).join('\n')}`)
    console.log(`러프: ${result.summary?.rough_min}~${result.summary?.rough_max}원`)
    break
  }
  if (result.outcome === 'escalate') {
    console.log(`에스컬레이션: ${result.escalation ?? result.message}`)
    break
  }

  // 첫 번째 보기로 자동 답변
  const [latest] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.requestId, request!.id), eq(messages.role, 'agent')))
    .orderBy(desc(messages.round))
    .limit(1)
  const qs = await db
    .select()
    .from(messageQuestions)
    .where(eq(messageQuestions.messageId, latest!.id))
    .orderBy(asc(messageQuestions.idx))

  for (const q of qs) {
    const answer = (q.options as string[])[0] ?? '네'
    console.log(`  Q: ${q.prompt}\n  A: ${answer}`)
    await db
      .update(messageQuestions)
      .set({ answerText: answer, answerOptionIdx: 0, answeredAt: new Date() })
      .where(eq(messageQuestions.id, q.id))
  }
  await enqueueJob(db, {
    projectId: project.id,
    requestId: request!.id,
    kind: 'intake_round',
  })
}

console.log(`\nREQ-${String(reqNo).padStart(3, '0')} 준비 완료 — 포털에서 확정하세요`)
await closeDb()
