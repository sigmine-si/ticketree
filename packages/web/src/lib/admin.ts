/**
 * 관리자 데이터 계층 — spec.md §5
 *
 * 메인은 현황판이 아니라 결정 큐다. 그래서 이 파일의 중심 개념은 status가 아니라
 * "지금 사람이 내려야 하는 결정"이다.
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import {
  changeRequests,
  estimates,
  jobs,
  messages,
  projects,
  pullRequests,
  users,
  type EstimationResult,
  type IntakeResult,
  type RequestFlag,
  type RequestKind,
  type RequestStatus,
  type SowDoc,
  type SowResult,
  migrateCommandOf,
  needsMigration,
  pendingNotices,
} from '@ticketree/shared'
import { db } from './data'
import { decisionOf, DECISION_ORDER, type Decision } from './decision'
import {
  generateInviteToken,
  generatePin,
  hashInviteToken,
  hashPin,
  MAX_PIN_ATTEMPTS,
} from './invite'

export { decisionOf, DECISION_LABEL, DECISION_TONE, type Decision } from './decision'

export interface QueueRow {
  id: string
  kind: RequestKind
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
      kind: changeRequests.kind,
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
      const kind = r.kind as RequestKind
      return {
        ...r,
        kind,
        status,
        flag,
        decision,
        note: adminNote(status, flag, job?.statusText ?? null, kind),
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
  kind: RequestKind = 'change',
): string {
  if (flag === 'escalated') return '에이전트 질문 — 해석이 필요합니다'
  if (flag === 'failed') return 'job 실패 — 재시도 후에도 실패'
  if (statusText) return statusText
  if (kind === 'sow') {
    switch (status) {
      case 'draft':
        return '과업내용서 정리 중 — 아직 확정 전'
      case 'awaiting_client':
        return '클라이언트 답변 대기'
      case 'submitted':
        return '확정됨 — 명세 초안 작성 중'
      case 'client_approved':
        return '과업내용서 명세 검토 필요 — 머지하면 계약이 발효됩니다'
      case 'sow_active':
        return '계약 발효 중 — 이 범위가 견적의 기준이 됩니다'
    }
  }
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
export interface NoticeRow {
  id: string
  type: string
  createdAt: Date
  reqNo: number | null
  title: string | null
  projectSlug: string
  projectName: string
  requestId: string
}

/** 알림 문구 — 타입 하나에 문장 하나. 화면이 문자열을 조립하지 않는다. */
export const NOTICE_LABEL: Record<string, string> = {
  question_arrived: '확인 질문을 보냈어요',
  quote_ready: '견적이 나왔어요 — 클라이언트 승인 대기',
  preview_ready: '미리보기가 준비됐어요',
  deployed: '배포가 끝났어요',
  manual_deploy_required: '머지됐어요 — 실제 배포가 필요해요',
  escalated: '담당자가 막혔어요 — 답변이 필요해요',
  job_failed: '작업이 실패했어요',
  sow_active: '과업내용서가 발효됐어요 — 이제 이 범위로 요청을 받습니다',
}

/**
 * 아직 안 읽은 알림. 지금까지 pending_notices 는 쌓기만 하고 읽는 곳이 없었다 —
 * 관리자가 큐를 직접 새로고침해야 무슨 일이 일어났는지 알 수 있었다.
 */
export async function pendingNoticeList(limit = 30): Promise<NoticeRow[]> {
  const rows = await db
    .select({
      id: pendingNotices.id,
      type: pendingNotices.type,
      createdAt: pendingNotices.createdAt,
      requestId: pendingNotices.requestId,
      reqNo: changeRequests.reqNo,
      title: changeRequests.title,
      projectSlug: projects.slug,
      projectName: projects.name,
    })
    .from(pendingNotices)
    .innerJoin(changeRequests, eq(changeRequests.id, pendingNotices.requestId))
    .innerJoin(projects, eq(projects.id, changeRequests.projectId))
    .where(isNull(pendingNotices.dismissedAt))
    .orderBy(desc(pendingNotices.createdAt))
    .limit(limit)
  return rows
}

/** 클라이언트 컴포넌트로 넘길 형태 — Date는 경계를 넘지 않는다. */
export async function noticeItems() {
  return (await pendingNoticeList()).map((n) => ({
    id: n.id,
    type: n.type,
    label: NOTICE_LABEL[n.type] ?? '새 알림',
    createdAt: n.createdAt.toISOString(),
    reqNo: n.reqNo,
    title: n.title,
    projectSlug: n.projectSlug,
    projectName: n.projectName,
  }))
}

export async function dismissNotices(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await db
    .update(pendingNotices)
    .set({ dismissedAt: new Date() })
    .where(inArray(pendingNotices.id, ids))
}

export interface CostRow {
  requestId: string
  reqNo: number | null
  title: string | null
  status: string
  projectSlug: string
  projectName: string
  /** 확정 견적(원). 관리자가 조정했으면 그 값이다. */
  billed: number | null
  costUsd: number
  tokens: number
  jobCount: number
  seconds: number
}

/**
 * 요청별 원가 — 견적 대비 실제가 어땠는지를 보는 곳 (§8).
 * 이 표가 견적 보정의 데이터 자산이다. 모델은 만들지 않고 데이터만 쌓는다.
 */
export async function costByRequest(limit = 100): Promise<CostRow[]> {
  const rows = await db
    .select({
      requestId: changeRequests.id,
      reqNo: changeRequests.reqNo,
      title: changeRequests.title,
      status: changeRequests.status,
      projectSlug: projects.slug,
      projectName: projects.name,
      billed: sql<number | null>`max(coalesce(${estimates.finalAmount}, ${estimates.proposedAmount}))`,
      costUsd: sql<number>`coalesce(sum(${jobs.costUsd}), 0)::float`,
      tokens: sql<number>`coalesce(sum(${jobs.tokensIn} + ${jobs.tokensOut}), 0)::bigint`,
      jobCount: sql<number>`count(distinct ${jobs.id})::int`,
      seconds: sql<number>`coalesce(sum(extract(epoch from (${jobs.finishedAt} - ${jobs.startedAt}))), 0)::float`,
    })
    .from(changeRequests)
    .innerJoin(projects, eq(projects.id, changeRequests.projectId))
    .leftJoin(jobs, eq(jobs.requestId, changeRequests.id))
    .leftJoin(estimates, eq(estimates.requestId, changeRequests.id))
    .groupBy(
      changeRequests.id,
      changeRequests.reqNo,
      changeRequests.title,
      changeRequests.status,
      projects.slug,
      projects.name,
    )
    .orderBy(desc(sql`coalesce(sum(${jobs.costUsd}), 0)`))
    .limit(limit)
  return rows.map((r) => ({ ...r, tokens: Number(r.tokens), billed: r.billed === null ? null : Number(r.billed) }))
}

/** job 종류별 집계 — 어느 단계가 비싼지 (§8 모델 선택이 원가를 지배한다) */
export async function costByKind() {
  return db
    .select({
      kind: jobs.kind,
      n: sql<number>`count(*)::int`,
      costUsd: sql<number>`coalesce(sum(${jobs.costUsd}), 0)::float`,
      avgSeconds: sql<number>`coalesce(avg(extract(epoch from (${jobs.finishedAt} - ${jobs.startedAt}))), 0)::float`,
      tokensOut: sql<number>`coalesce(sum(${jobs.tokensOut}), 0)::bigint`,
    })
    .from(jobs)
    .where(isNotNull(jobs.finishedAt))
    .groupBy(jobs.kind)
    .orderBy(desc(sql`coalesce(sum(${jobs.costUsd}), 0)`))
}

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
  /** 과업내용서 본문 — kind='sow'일 때만 채워진다 */
  sow: SowDoc | null
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
  /** Spec PR (§6). 승인 근거 3종 중 첫 번째. */
  specPr: PrView | null
  /** 코드 PR — in_review 이후 배포 검토의 근거. */
  codePr: (PrView & { previewUrl: string | null }) | null
  /** 이 배포에 DB 반영이 따라와야 하는가 (§16-6 — 실행은 운영자가 한다) */
  migration: { required: boolean; command: string }
}

export interface PrView {
  number: number
  status: string
  branch: string | null
  diff: string | null
  url: string
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

  // 과업내용서면 탐색 노트가 아니라 계약 본문이 검토 대상이다
  const sow =
    (msgs.find((m) => m.role === 'agent' && (m.payload as SowResult | null)?.sow)
      ?.payload as SowResult | null)?.sow ?? null

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
    // 과업내용서의 명세 PR도 같은 자리에 걸린다 — 한 요청에 둘 다 있을 수는 없다
    .where(and(eq(pullRequests.requestId, requestId), inArray(pullRequests.kind, ['spec', 'sow_spec'])))
    .orderBy(desc(pullRequests.createdAt))
    .limit(1)

  const [codePr] = await db
    .select()
    .from(pullRequests)
    .where(and(eq(pullRequests.requestId, requestId), eq(pullRequests.kind, 'code')))
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
    sow,
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
    codePr: codePr
      ? {
          number: codePr.prNumber,
          status: codePr.status,
          branch: codePr.branch,
          diff: codePr.diff,
          url: `https://github.com/${project!.hubRepo}/pull/${codePr.prNumber}`,
          previewUrl: codePr.previewUrl,
        }
      : null,
    migration: {
      required: needsMigration(project?.settings, codePr?.diff ?? null),
      command: migrateCommandOf(project?.settings),
    },
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

// ─────────────────────────────── 고객 계정 — 초대 링크와 PIN 발급

export interface ClientAccount {
  userId: string
  name: string
  projectName: string
  slug: string
  /** 초대 링크를 마지막으로 발급한 시각. 없으면 아직 한 번도 안 냈다. */
  issuedAt: Date | null
  /** 5회 연속 실패로 잠긴 상태. 재발급해야만 풀린다. */
  locked: boolean
  attemptsLeft: number
}

export async function listClientAccounts(): Promise<ClientAccount[]> {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      projectName: projects.name,
      slug: projects.slug,
      issuedAt: users.inviteIssuedAt,
      hasToken: users.inviteTokenHash,
      failed: users.pinFailedCount,
    })
    .from(users)
    .innerJoin(projects, eq(users.projectId, projects.id))
    .where(eq(users.kind, 'client'))
    .orderBy(asc(projects.name), asc(users.name))

  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    projectName: r.projectName,
    slug: r.slug,
    issuedAt: r.hasToken ? r.issuedAt : null,
    locked: r.failed >= MAX_PIN_ATTEMPTS,
    attemptsLeft: Math.max(0, MAX_PIN_ATTEMPTS - r.failed),
  }))
}

/**
 * 초대 링크와 PIN을 발급한다. 평문은 이 반환값에만 실린다 — 저장은 해시뿐이라
 * 관리자가 화면을 닫으면 아무도 다시 볼 수 없다.
 *
 * 같은 계정에 다시 발급하면 해시를 덮어써서 이전 링크·PIN이 함께 죽는다.
 * 잠금(연속 실패)이 풀리는 유일한 경로도 여기다.
 */
export async function issueInvite(
  userId: string,
): Promise<{ token: string; pin: string; slug: string; name: string } | null> {
  const [target] = await db
    .select({ id: users.id, name: users.name, slug: projects.slug })
    .from(users)
    .innerJoin(projects, eq(users.projectId, projects.id))
    .where(and(eq(users.id, userId), eq(users.kind, 'client')))
  if (!target) return null

  const token = generateInviteToken()
  const pin = generatePin()

  await db
    .update(users)
    .set({
      inviteTokenHash: hashInviteToken(token),
      pinHash: hashPin(pin),
      inviteIssuedAt: new Date(),
      pinFailedCount: 0,
    })
    .where(eq(users.id, target.id))

  return { token, pin, slug: target.slug, name: target.name }
}
