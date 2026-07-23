/**
 * 과업내용서 대화 job
 *
 * sow_intake = 첫 라운드, 새 세션
 * sow_round  = 클라이언트 답변 후 재개 (--resume)
 *
 * 접수 대화(intake.ts)와 같은 길을 지난다. 갈라지는 곳은 셋뿐이다.
 *  1. 프롬프트와 파서가 과업내용서용이다
 *  2. ready여도 러프 견적을 남기지 않는다 — 과업내용서에는 견적 단계가 없다
 *  3. 세션 kind가 'sow'다 — 같은 요청에 접수 세션이 섞이지 않게 한다
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { and, desc, eq } from 'drizzle-orm'
import {
  agentSessions,
  changeRequests,
  messageQuestions,
  messages,
  projects,
  parseSowResult,
  policyForJob,
  transition,
  type Db,
  type RequestStatus,
} from '@ticketree/shared'
import { runAgent } from '../agent/claude.js'
import { createProgressReader } from '../agent/progress.js'
import { statusTextFrom } from '../agent/status-text.js'
import { setStatusText, type ClaimedJob, type JobOutcome } from '../queue.js'
import { applyOutcome, buildResumePrompt } from './intake.js'
import { SOW_CLOSING, SOW_SYSTEM, sowFirstRoundPrompt } from './sow-prompt.js'

const AGENT = { kind: 'agent' as const }

/**
 * 이 저장소에 이미 명세가 있는가 — 첫 계약과 추가 계약을 가른다.
 *
 * 에이전트에게 맡기지 않고 러너가 판정한다. 못 찾았을 때 조용히 넘어가면
 * 2차 계약이 1차에서 이미 약속한 것을 다시 범위에 넣는다.
 */
export function hasSpecFiles(cwd: string): boolean {
  const dir = join(cwd, 'specs')
  if (!existsSync(dir)) return false
  try {
    if (readdirSync(dir).some((f) => f.endsWith('.md'))) return true
    const features = join(dir, 'features')
    return existsSync(features) && readdirSync(features).some((f) => f.endsWith('.md'))
  } catch {
    return false
  }
}

export async function runSowJob(db: Db, job: ClaimedJob): Promise<JobOutcome> {
  if (!job.requestId) throw new Error('sow job requires a request_id')

  const [request] = await db
    .select()
    .from(changeRequests)
    .where(eq(changeRequests.id, job.requestId))
  if (!request) throw new Error(`request ${job.requestId} not found`)

  const [project] = await db.select().from(projects).where(eq(projects.id, job.projectId))
  if (!project?.workspacePath) {
    throw new Error(`project ${job.projectId} has no workspace_path — 프로비저닝이 안 끝났다`)
  }

  const isFirstRound = job.kind === 'sow_intake'
  const cwd = project.workspacePath

  const [session] = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.requestId, request.id), eq(agentSessions.kind, 'sow')))
    .orderBy(desc(agentSessions.startedAt))
    .limit(1)

  const prompt = isFirstRound
    ? sowFirstRoundPrompt({
        background: request.toBe,
        hasSpecs: hasSpecFiles(cwd),
        seq: request.reqNo ?? 1,
      })
    : await buildResumePrompt(db, request.id, SOW_CLOSING)

  // exploring은 "job 실행 중"이라는 뜻의 일시 상태다 — 에스컬레이션으로 멈추면 되돌린다
  const priorStatus = request.status as RequestStatus
  await transition(db, request.id, 'exploring', AGENT, { jobId: job.id })

  let lastText = ''
  const progress = createProgressReader()
  const show = (text: string) => {
    if (!text || text === lastText) return
    lastText = text
    void setStatusText(db, job.id, text).catch(() => {})
  }

  const run = await runAgent({
    prompt,
    cwd,
    policy: policyForJob(job.kind),
    resumeSessionId: isFirstRound ? undefined : (session?.sessionId ?? undefined),
    appendSystemPrompt: SOW_SYSTEM,
    onTextDelta: (chunk) => {
      for (const line of progress.push(chunk)) show(line)
    },
    onEvent: (ev) => {
      if (lastText) return
      show(statusTextFrom(ev) ?? '')
    },
  })

  const result = parseSowResult(run.text)

  await db.transaction(async (tx) => {
    if (session) {
      await tx
        .update(agentSessions)
        .set({
          sessionId: run.sessionId,
          lastResumedAt: new Date(),
          tokenTotal: session.tokenTotal + run.tokensIn + run.tokensOut,
        })
        .where(eq(agentSessions.id, session.id))
    } else {
      await tx.insert(agentSessions).values({
        requestId: request.id,
        sessionId: run.sessionId,
        cwd,
        kind: 'sow',
        tokenTotal: run.tokensIn + run.tokensOut,
      })
    }

    await tx
      .update(changeRequests)
      .set({ title: result.title, updatedAt: new Date() })
      .where(eq(changeRequests.id, request.id))

    const prior = await tx
      .select({ round: messages.round })
      .from(messages)
      .where(eq(messages.requestId, request.id))
      .orderBy(desc(messages.round))
      .limit(1)
    const round = prior[0]?.round ?? 0

    const [agentMessage] = await tx
      .insert(messages)
      .values({
        requestId: request.id,
        round: round + 1,
        role: 'agent',
        content: result.message,
        payload: result as never,
      })
      .returning({ id: messages.id })

    if (result.outcome === 'questions') {
      await tx.insert(messageQuestions).values(
        result.questions.map((q, idx) => ({
          messageId: agentMessage!.id,
          idx,
          prompt: q.prompt,
          hint: q.hint ?? null,
          kind: q.kind,
          options: q.options as never,
        })),
      )
    }
    // ready여도 estimates를 남기지 않는다 — 과업내용서는 견적 흐름을 타지 않는다
  })

  await applyOutcome(db, request.id, result, priorStatus)

  return {
    status: 'done',
    result: result as never,
    tokensIn: run.tokensIn,
    tokensOut: run.tokensOut,
    costUsd: run.costUsd,
    model: run.model,
  }
}
