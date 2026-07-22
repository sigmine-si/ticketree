/**
 * 접수 대화 job — spec.md §2, §4
 *
 * exploration  = 첫 라운드, 새 세션
 * intake_round = 클라이언트 답변 후 재개 (--resume)
 *
 * 두 job은 같은 코드를 지난다. 차이는 resume 여부와 프롬프트뿐이다.
 */
import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm'
import {
  agentSessions,
  changeRequests,
  estimates,
  messageQuestions,
  messages,
  pendingNotices,
  projects,
  parseIntakeResult,
  policyForJob,
  transition,
  type Db,
  type IntakeResult,
  type RequestStatus,
} from '@ticketree/shared'
import { runAgent } from '../agent/claude.js'
import { createProgressReader } from '../agent/progress.js'
import { statusTextFrom } from '../agent/status-text.js'
import { setStatusText, type JobOutcome } from '../queue.js'
import { answerRoundPrompt, firstRoundPrompt, INTAKE_SYSTEM } from './intake-prompt.js'
import type { ClaimedJob } from '../queue.js'

const AGENT = { kind: 'agent' as const }

export async function runIntakeJob(db: Db, job: ClaimedJob): Promise<JobOutcome> {
  if (!job.requestId) throw new Error('intake job requires a request_id')

  const [request] = await db
    .select()
    .from(changeRequests)
    .where(eq(changeRequests.id, job.requestId))
  if (!request) throw new Error(`request ${job.requestId} not found`)

  const [project] = await db.select().from(projects).where(eq(projects.id, job.projectId))
  if (!project?.workspacePath) {
    throw new Error(`project ${job.projectId} has no workspace_path — 프로비저닝이 안 끝났다`)
  }

  const isFirstRound = job.kind === 'exploration'
  const cwd = project.workspacePath

  // 기존 세션 찾기 — resume에는 session_id와 cwd가 둘 다 필요하다 (§4)
  const [session] = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.requestId, request.id), eq(agentSessions.kind, 'intake')))
    .orderBy(desc(agentSessions.startedAt))
    .limit(1)

  const prompt = isFirstRound
    ? firstRoundPrompt({
        asIs: request.asIs,
        toBe: request.toBe,
        urgency: request.urgency,
        attachmentNote: null,
      })
    : await buildResumePrompt(db, request.id)

  // exploring은 "job 실행 중"이라는 뜻의 일시 상태다. 에스컬레이션으로 멈추면
  // 여기로 돌려놓아야 한다 — 안 그러면 요청이 영원히 실행 중으로 보인다.
  const priorStatus = request.status as RequestStatus
  await transition(db, request.id, 'exploring', AGENT, { jobId: job.id })

  const policy = policyForJob(job.kind)
  let lastText = ''
  const progress = createProgressReader()

  /** 실패해도 job을 죽이지 않는다 — 버퍼링 문구는 부가 정보다. */
  const show = (text: string) => {
    if (!text || text === lastText) return
    lastText = text
    void setStatusText(db, job.id, text).catch(() => {})
  }

  const run = await runAgent({
    prompt,
    cwd,
    policy,
    resumeSessionId: isFirstRound ? undefined : (session?.sessionId ?? undefined),
    appendSystemPrompt: INTAKE_SYSTEM,
    // 에이전트가 남긴 진행 문구가 있으면 그게 이긴다 — 고정 문구보다 구체적이다
    onTextDelta: (chunk) => {
      for (const line of progress.push(chunk)) show(line)
    },
    onEvent: (ev) => {
      // 진행 문구가 아직 하나도 없을 때만 고정 문구를 쓴다
      if (lastText) return
      show(statusTextFrom(ev) ?? '')
    },
  })

  const result = parseIntakeResult(run.text)

  await db.transaction(async (tx) => {
    // 세션 기록 — 다음 라운드가 이걸로 재개한다
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
        kind: 'intake',
        tokenTotal: run.tokensIn + run.tokensOut,
      })
    }

    // 제목은 매 라운드 갱신한다 — 대화가 진행되며 정확해진다
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

    if (result.outcome === 'ready' && result.summary) {
      await tx.insert(estimates).values({
        requestId: request.id,
        version: 1,
        roughMin: result.summary.rough_min,
        roughMax: result.summary.rough_max,
        estimatedDays: result.summary.estimated_days,
        wbs: result.summary.scope as never,
      })
    }
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

/** 결과에 따라 상태를 옮기고 수동 알림 큐에 쌓는다 (§11). */
async function applyOutcome(
  db: Db,
  requestId: string,
  result: IntakeResult,
  priorStatus: RequestStatus,
): Promise<void> {
  if (result.outcome === 'questions') {
    await transition(db, requestId, 'awaiting_client', AGENT, {
      questionCount: result.questions.length,
    })
    await db.insert(pendingNotices).values({ requestId, type: 'question_arrived' })
    return
  }

  if (result.outcome === 'escalate') {
    // 에스컬레이션은 status를 덮지 않고 플래그로 얹는다 (§7).
    // 단, job 실행 중을 뜻하는 exploring에서는 벗어나야 한다.
    await transition(db, requestId, priorStatus, AGENT, {
      escalated: true,
      reason: result.escalation ?? null,
    })
    await db
      .update(changeRequests)
      .set({
        flag: 'escalated',
        flagFromStatus: priorStatus,
        // 공을 쥔 쪽은 관리자다 — 클라이언트 앰버 점을 켜지 않는다
        yourTurn: false,
        updatedAt: new Date(),
      })
      .where(eq(changeRequests.id, requestId))
    await db.insert(pendingNotices).values({ requestId, type: 'escalated' })
    return
  }

  // ready — 확정 가능하지만 티켓 발행은 클라이언트가 버튼을 눌러야 일어난다 (§2).
  // 그래서 status는 draft에 머문다. UI가 payload.outcome을 보고 확정 버튼을 띄운다.
  await transition(db, requestId, 'draft', AGENT, { ready: true })
}

/**
 * 재개 프롬프트를 만든다.
 *
 * 라운드를 다시 깨우는 계기는 둘이다 — 클라이언트가 질문에 답했거나(§16-2),
 * 관리자가 에스컬레이션을 해석해줬거나(§5). 둘 다 여기로 들어온다.
 */
async function buildResumePrompt(db: Db, requestId: string): Promise<string> {
  const [latest] = await db
    .select({ id: messages.id, round: messages.round })
    .from(messages)
    .where(and(eq(messages.requestId, requestId), eq(messages.role, 'agent')))
    .orderBy(desc(messages.round))
    .limit(1)

  const answers = latest
    ? (
        await db
          .select()
          .from(messageQuestions)
          .where(eq(messageQuestions.messageId, latest.id))
          .orderBy(asc(messageQuestions.idx))
      )
        .filter((q) => q.answeredAt !== null)
        .map((q) => ({ prompt: q.prompt, answer: q.answerText ?? '' }))
    : []

  // 마지막 에이전트 응답 이후에 들어온 운영자 해석
  const operatorNotes = latest
    ? (
        await db
          .select({ content: messages.content })
          .from(messages)
          .where(
            and(
              eq(messages.requestId, requestId),
              eq(messages.role, 'system'),
              gt(messages.round, latest.round),
            ),
          )
          .orderBy(asc(messages.round))
      ).map((m) => m.content)
    : []

  return answerRoundPrompt({
    answers,
    operatorNotes,
  })
}

/** 아직 답이 안 온 질문이 있는지 — 라운드 종료 판정에 쓴다 (§16-2). */
export async function hasUnansweredQuestions(db: Db, messageId: string): Promise<boolean> {
  const rows = await db
    .select({ id: messageQuestions.id })
    .from(messageQuestions)
    .where(and(eq(messageQuestions.messageId, messageId), isNull(messageQuestions.answeredAt)))
    .limit(1)
  return rows.length > 0
}
