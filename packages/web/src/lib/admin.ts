/**
 * 관리자 데이터 계층 — spec.md §5
 *
 * 메인은 현황판이 아니라 결정 큐다. 그래서 이 파일의 중심 개념은 status가 아니라
 * "지금 사람이 내려야 하는 결정"이다.
 */
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import {
  changeRequests,
  estimates,
  jobs,
  messages,
  projects,
  pullRequests,
  type EstimationResult,
  type IntakeResult,
  type RequestFlag,
  type RequestStatus,
} from '@ticketree/shared'
import { db } from './data'
import { decisionOf, DECISION_ORDER, type Decision } from './decision'

export { decisionOf, DECISION_LABEL, DECISION_TONE, type Decision } from './decision'

export interface QueueRow {
  id: string
  reqNo: number | null
  title: string | null
  projectName: string
  clientName: string
  projectSlug: string
  status: RequestStatus
  flag: RequestFlag | null
  decision: Decision
  note: string
  updatedAt: Date
  finalAmount: number | null
  proposedAmount: number | null
  costUsd: number
}

export async function listQueue(): Promise<QueueRow[]> {
  const rows = await db
    .select({
      id: changeRequests.id,
      reqNo: changeRequests.reqNo,
      title: changeRequests.title,
      status: changeRequests.status,
      flag: changeRequests.flag,
      updatedAt: changeRequests.updatedAt,
      projectName: projects.name,
      clientName: projects.clientName,
      projectSlug: projects.slug,
    })
    .from(changeRequests)
    .innerJoin(projects, eq(changeRequests.projectId, projects.id))
    .orderBy(desc(changeRequests.updatedAt))

  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)

  const running = await db
    .select({ requestId: jobs.requestId, statusText: jobs.statusText, kind: jobs.kind })
    .from(jobs)
    .where(and(inArray(jobs.requestId, ids), inArray(jobs.status, ['running', 'queued'])))

  const spend = await db
    .select({
      requestId: jobs.requestId,
      cost: sql<number>`coalesce(sum(${jobs.costUsd}), 0)::float`,
    })
    .from(jobs)
    .where(inArray(jobs.requestId, ids))
    .groupBy(jobs.requestId)

  const ests = await db
    .select({
      requestId: estimates.requestId,
      finalAmount: estimates.finalAmount,
      proposedAmount: estimates.proposedAmount,
    })
    .from(estimates)
    .where(inArray(estimates.requestId, ids))

  const runBy = new Map(running.map((j) => [j.requestId!, j]))
  const costBy = new Map(spend.map((s) => [s.requestId!, s.cost]))
  const estBy = new Map(ests.map((e) => [e.requestId, e]))

  return rows
    .map((r) => {
      const status = r.status as RequestStatus
      const flag = r.flag as RequestFlag | null
      const job = runBy.get(r.id)
      const decision = decisionOf(status, flag, Boolean(job))
      return {
        ...r,
        status,
        flag,
        decision,
        note: adminNote(status, flag, job?.statusText ?? null),
        finalAmount: estBy.get(r.id)?.finalAmount ?? null,
        proposedAmount: estBy.get(r.id)?.proposedAmount ?? null,
        costUsd: costBy.get(r.id) ?? 0,
      }
    })
    .sort((a, b) =>
      DECISION_ORDER[a.decision] !== DECISION_ORDER[b.decision]
        ? DECISION_ORDER[a.decision] - DECISION_ORDER[b.decision]
        : b.updatedAt.getTime() - a.updatedAt.getTime(),
    )
}

/** 관리자용 한 줄 — 클라이언트용 문구와 다르다. 여기선 내부 사정을 그대로 쓴다. */
function adminNote(
  status: RequestStatus,
  flag: RequestFlag | null,
  statusText: string | null,
): string {
  if (flag === 'escalated') return '에이전트 질문 — 해석이 필요합니다'
  if (flag === 'failed') return 'job 실패 — 재시도 후에도 실패'
  if (statusText) return statusText
  switch (status) {
    case 'draft':
      return '접수 대화 중 — 아직 확정 전'
    case 'awaiting_client':
      return '클라이언트 답변 대기'
    case 'quote_ready':
      return '클라이언트 견적 승인 대기'
    case 'client_approved':
      return '클라이언트 견적 승인 완료 — Spec 변경안 검토 필요'
    case 'in_review':
      return '구현 PR 생성됨 — 미리보기 확인 후 배포 승인'
    case 'awaiting_manual_deploy':
      return '머지 완료 — 수동 배포 후 완료 처리 필요'
    case 'deployed':
      return '배포 완료'
    default:
      return ''
  }
}

/** 상단 상시 표시 지표 — §5 */
export async function ledger() {
  const [todayCost] = await db
    .select({
      usd: sql<number>`coalesce(sum(${jobs.costUsd}), 0)::float`,
      n: sql<number>`count(*)::int`,
    })
    .from(jobs)
    .where(sql`${jobs.finishedAt} >= date_trunc('day', now())`)

  const [running] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(eq(jobs.status, 'running'))

  const [queued] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(eq(jobs.status, 'queued'))

  const [month] = await db
    .select({
      total: sql<number>`coalesce(sum(${estimates.finalAmount}), 0)::int`,
      n: sql<number>`count(*)::int`,
    })
    .from(estimates)
    .where(
      and(
        isNotNull(estimates.finalAmount),
        sql`date_trunc('month', ${estimates.clientApprovedAt}) = date_trunc('month', now())`,
      ),
    )

  const [monthCost] = await db
    .select({ usd: sql<number>`coalesce(sum(${jobs.costUsd}), 0)::float` })
    .from(jobs)
    .where(sql`date_trunc('month', ${jobs.finishedAt}) = date_trunc('month', now())`)

  return {
    todayCostUsd: todayCost?.usd ?? 0,
    todayJobs: todayCost?.n ?? 0,
    running: running?.n ?? 0,
    queued: queued?.n ?? 0,
    monthTotal: month?.total ?? 0,
    monthCount: month?.n ?? 0,
    monthCostUsd: monthCost?.usd ?? 0,
  }
}

export interface ReviewDetail {
  request: typeof changeRequests.$inferSelect
  project: typeof projects.$inferSelect
  intake: IntakeResult | null
  estimation: EstimationResult | null
  estimate: typeof estimates.$inferSelect | null
  qa: Array<{ prompt: string; answer: string }>
  jobs: Array<{
    id: string
    kind: string
    status: string
    costUsd: number | null
    tokens: number
    model: string | null
  }>
  /** 유사 규모 과거 건 평균 — 견적 조정의 근거 (§8) */
  similar: { n: number; avgCostUsd: number; avgHours: number | null }
  /** 허브 repo의 Spec PR (§6). 승인 근거 3종 중 첫 번째. */
  specPr: {
    number: number
    status: string
    branch: string | null
    diff: string | null
    url: string
  } | null
}

export async function getReviewDetail(requestId: string): Promise<ReviewDetail | null> {
  const [request] = await db.select().from(changeRequests).where(eq(changeRequests.id, requestId))
  if (!request) return null

  const [project] = await db.select().from(projects).where(eq(projects.id, request.projectId))

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.requestId, requestId))
    .orderBy(desc(messages.round))

  const intake =
    (msgs.find((m) => m.role === 'agent' && (m.payload as IntakeResult | null)?.summary)
      ?.payload as IntakeResult | null) ??
    (msgs.find((m) => m.role === 'agent')?.payload as IntakeResult | null) ??
    null

  const [estimate] = await db
    .select()
    .from(estimates)
    .where(eq(estimates.requestId, requestId))
    .orderBy(desc(estimates.version))
    .limit(1)

  const estimation = (estimate?.wbs ?? null) as EstimationResult | null

  const jobRows = await db
    .select({
      id: jobs.id,
      kind: jobs.kind,
      status: jobs.status,
      costUsd: jobs.costUsd,
      tokensIn: jobs.tokensIn,
      tokensOut: jobs.tokensOut,
      model: jobs.model,
    })
    .from(jobs)
    .where(eq(jobs.requestId, requestId))
    .orderBy(jobs.queuedAt)

  const [specPr] = await db
    .select()
    .from(pullRequests)
    .where(and(eq(pullRequests.requestId, requestId), eq(pullRequests.kind, 'spec')))
    .orderBy(desc(pullRequests.createdAt))
    .limit(1)

  const [similar] = await db
    .select({
      n: sql<number>`count(distinct ${jobs.requestId})::int`,
      avgCost: sql<number>`coalesce(avg(${jobs.costUsd}), 0)::float`,
    })
    .from(jobs)
    .where(and(eq(jobs.projectId, request.projectId), eq(jobs.status, 'done')))

  return {
    request,
    project: project!,
    intake,
    estimation: estimation && 'wbs' in (estimation as object) ? estimation : null,
    estimate: estimate ?? null,
    qa: await collectQa(requestId),
    jobs: jobRows.map((j) => ({
      id: j.id,
      kind: j.kind,
      status: j.status,
      costUsd: j.costUsd !== null ? Number(j.costUsd) : null,
      tokens: j.tokensIn + j.tokensOut,
      model: j.model,
    })),
    similar: {
      n: similar?.n ?? 0,
      avgCostUsd: similar?.avgCost ?? 0,
      avgHours: null,
    },
    specPr: specPr
      ? {
          number: specPr.prNumber,
          status: specPr.status,
          branch: specPr.branch,
          diff: specPr.diff,
          url: `https://github.com/${project!.hubRepo}/pull/${specPr.prNumber}`,
        }
      : null,
  }
}

async function collectQa(requestId: string): Promise<Array<{ prompt: string; answer: string }>> {
  const rows = await db.execute<{ prompt: string; answer_text: string }>(sql`
    select q.prompt, q.answer_text
    from message_questions q
    join messages m on m.id = q.message_id
    where m.request_id = ${requestId} and q.answered_at is not null
    order by m.round, q.idx
  `)
  return (rows.rows ?? []).map((r) => ({ prompt: r.prompt, answer: r.answer_text }))
}
