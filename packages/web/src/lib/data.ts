/**
 * 데이터 접근 계층 — spec.md §9
 *
 * 여기 있는 함수는 전부 projectId를 첫 인자로 받고, 모든 쿼리에 그 조건을 건다.
 * 페이지·라우트가 drizzle을 직접 부르지 않는다 — 스코프를 빠뜨릴 여지를 없앤다.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import {
  changeRequests,
  createDb,
  estimates,
  jobs,
  messageQuestions,
  messages,
  projects,
  users,
  type IntakeResult,
  type RequestFlag,
  type RequestStatus,
  type SowResult,
} from '@ticketree/shared'
import { hashInviteToken, MAX_PIN_ATTEMPTS } from './invite'

const db = createDb()

export { db }

export interface RequestRow {
  id: string
  reqNo: number | null
  title: string | null
  status: RequestStatus
  flag: RequestFlag | null
  yourTurn: boolean
  updatedAt: Date
  roughMin: number | null
  roughMax: number | null
  finalAmount: number | null
  /** 실행 중인 job의 버퍼링 문구 — 있으면 목록에 스피너를 띄운다 */
  runningStatusText: string | null
}

export async function getProjectBySlug(slug: string) {
  const [p] = await db.select().from(projects).where(eq(projects.slug, slug))
  return p ?? null
}

export async function listRequests(projectId: string): Promise<RequestRow[]> {
  const rows = await db
    .select({
      id: changeRequests.id,
      reqNo: changeRequests.reqNo,
      title: changeRequests.title,
      status: changeRequests.status,
      flag: changeRequests.flag,
      yourTurn: changeRequests.yourTurn,
      updatedAt: changeRequests.updatedAt,
    })
    .from(changeRequests)
    // 과업내용서는 요청이 아니다 — 이 필터가 두 목록이 섞이지 않게 하는 불변식이고,
    // 덕분에 stageOf(4단계)가 kind를 몰라도 된다
    .where(and(eq(changeRequests.projectId, projectId), eq(changeRequests.kind, 'change')))
    .orderBy(desc(changeRequests.updatedAt))

  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)

  const ests = await db
    .select({
      requestId: estimates.requestId,
      roughMin: estimates.roughMin,
      roughMax: estimates.roughMax,
      finalAmount: estimates.finalAmount,
    })
    .from(estimates)
    .where(inArray(estimates.requestId, ids))

  const running = await db
    .select({ requestId: jobs.requestId, statusText: jobs.statusText })
    .from(jobs)
    .where(and(inArray(jobs.requestId, ids), eq(jobs.status, 'running')))

  const estBy = new Map(ests.map((e) => [e.requestId, e]))
  const runBy = new Map(running.map((j) => [j.requestId!, j.statusText]))

  return rows.map((r) => ({
    ...r,
    status: r.status as RequestStatus,
    flag: r.flag as RequestFlag | null,
    roughMin: estBy.get(r.id)?.roughMin ?? null,
    roughMax: estBy.get(r.id)?.roughMax ?? null,
    finalAmount: estBy.get(r.id)?.finalAmount ?? null,
    runningStatusText: runBy.get(r.id) ?? null,
  }))
}

/** 프로젝트 스코프를 건 단건 조회. 다른 프로젝트의 요청은 없는 것과 같다. */
export async function getRequest(projectId: string, reqNo: number) {
  const [r] = await db
    .select()
    .from(changeRequests)
    .where(and(eq(changeRequests.projectId, projectId), eq(changeRequests.reqNo, reqNo)))
  return r ?? null
}

export async function getRequestById(projectId: string, id: string) {
  const [r] = await db
    .select()
    .from(changeRequests)
    .where(and(eq(changeRequests.projectId, projectId), eq(changeRequests.id, id)))
  return r ?? null
}

// ─────────────────────────────── 과업내용서

export interface SowRow {
  id: string
  reqNo: number | null
  title: string | null
  status: RequestStatus
  flag: RequestFlag | null
  yourTurn: boolean
  updatedAt: Date
  confirmedAt: Date | null
  runningStatusText: string | null
  /** 확정된 과업 범위 항목 수 — 목록에서 규모를 가늠하는 값 */
  scopeCount: number
}

export async function listSows(projectId: string): Promise<SowRow[]> {
  const rows = await db
    .select({
      id: changeRequests.id,
      reqNo: changeRequests.reqNo,
      title: changeRequests.title,
      status: changeRequests.status,
      flag: changeRequests.flag,
      yourTurn: changeRequests.yourTurn,
      updatedAt: changeRequests.updatedAt,
      confirmedAt: changeRequests.confirmedAt,
    })
    .from(changeRequests)
    .where(and(eq(changeRequests.projectId, projectId), eq(changeRequests.kind, 'sow')))
    // 계약은 차수 순으로 읽힌다 — 최신 갱신순이 아니다
    .orderBy(desc(changeRequests.reqNo))

  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)

  // 라운드 오름차순으로 훑어 마지막으로 본문이 실린 것만 남긴다
  const msgs = await db
    .select({ requestId: messages.requestId, payload: messages.payload })
    .from(messages)
    .where(and(inArray(messages.requestId, ids), eq(messages.role, 'agent')))
    .orderBy(asc(messages.round))

  const scopeBy = new Map<string, number>()
  for (const m of msgs) {
    const sow = (m.payload as { sow?: { scope?: unknown[] } } | null)?.sow
    if (sow?.scope?.length) scopeBy.set(m.requestId, sow.scope.length)
  }

  const running = await db
    .select({ requestId: jobs.requestId, statusText: jobs.statusText })
    .from(jobs)
    .where(and(inArray(jobs.requestId, ids), eq(jobs.status, 'running')))
  const runBy = new Map(running.map((j) => [j.requestId!, j.statusText]))

  return rows.map((r) => ({
    ...r,
    status: r.status as RequestStatus,
    flag: r.flag as RequestFlag | null,
    scopeCount: scopeBy.get(r.id) ?? 0,
    runningStatusText: runBy.get(r.id) ?? null,
  }))
}

export async function getSow(projectId: string, sowNo: number) {
  const [r] = await db
    .select()
    .from(changeRequests)
    .where(
      and(
        eq(changeRequests.projectId, projectId),
        eq(changeRequests.kind, 'sow'),
        eq(changeRequests.reqNo, sowNo),
      ),
    )
  return r ?? null
}

/**
 * 발효 중인 과업내용서 — 새 요청이 어느 계약 아래 놓이는지 정한다.
 * 여러 개면 최신 차수가 앞이다.
 */
export async function getActiveSows(projectId: string) {
  return db
    .select()
    .from(changeRequests)
    .where(
      and(
        eq(changeRequests.projectId, projectId),
        eq(changeRequests.kind, 'sow'),
        eq(changeRequests.status, 'sow_active'),
      ),
    )
    .orderBy(desc(changeRequests.reqNo))
}

export interface ThreadQuestion {
  id: string
  idx: number
  prompt: string
  hint: string | null
  options: string[]
  answerText: string | null
  answeredAt: Date | null
}

/** 접수 대화와 과업내용서 대화가 같은 스레드에 실린다 — 결과 모양만 다르다 */
export type ThreadPayload = IntakeResult | SowResult

export interface ThreadMessage {
  id: string
  round: number
  role: 'client' | 'agent' | 'system'
  content: string
  payload: ThreadPayload | null
  createdAt: Date
  questions: ThreadQuestion[]
}

export async function getThread(requestId: string): Promise<ThreadMessage[]> {
  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.requestId, requestId))
    .orderBy(asc(messages.createdAt))

  if (msgs.length === 0) return []

  const qs = await db
    .select()
    .from(messageQuestions)
    .where(
      inArray(
        messageQuestions.messageId,
        msgs.map((m) => m.id),
      ),
    )
    .orderBy(asc(messageQuestions.idx))

  const byMessage = new Map<string, ThreadQuestion[]>()
  for (const q of qs) {
    const list = byMessage.get(q.messageId) ?? []
    list.push({
      id: q.id,
      idx: q.idx,
      prompt: q.prompt,
      hint: q.hint,
      options: q.options as string[],
      answerText: q.answerText,
      answeredAt: q.answeredAt,
    })
    byMessage.set(q.messageId, list)
  }

  return msgs.map((m) => ({
    id: m.id,
    round: m.round,
    role: m.role as ThreadMessage['role'],
    content: m.content,
    payload: (m.payload ?? null) as ThreadPayload | null,
    createdAt: m.createdAt,
    questions: byMessage.get(m.id) ?? [],
  }))
}

export async function getEstimate(requestId: string) {
  const [e] = await db
    .select()
    .from(estimates)
    .where(eq(estimates.requestId, requestId))
    .orderBy(desc(estimates.version))
    .limit(1)
  return e ?? null
}

/** 상단 스트립 — 월 확정 견적 합계. 카운터 없이 쿼리로 낸다 (§9). */
export async function monthlyTotals(projectId: string) {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${estimates.finalAmount}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(estimates)
    .innerJoin(changeRequests, eq(estimates.requestId, changeRequests.id))
    .where(
      and(
        eq(changeRequests.projectId, projectId),
        sql`${estimates.finalAmount} is not null`,
        sql`date_trunc('month', ${estimates.clientApprovedAt}) = date_trunc('month', now())`,
      ),
    )
  return row ?? { total: 0, count: 0 }
}

// ─────────────────────────────── 세션 이전 — 초대 링크와 PIN
//
// 이 아래 함수들만 projectId를 받지 않는다. 스코프를 정하는 쪽이라 스코프를
// 받을 수 없다 — 여기서 찾아낸 projectId가 세션에 실려 나머지 전부를 스코프한다.

export interface InviteTarget {
  userId: string
  name: string
  projectId: string
  projectName: string
  slug: string
  pinHash: string | null
  /** 남은 시도가 0이면 잠긴 것이다. 재발급 말고는 풀리지 않는다. */
  attemptsLeft: number
}

/** 토큰 평문으로 초대 대상을 찾는다. 저장된 것은 해시뿐이라 해시로 조회한다. */
export async function findInviteByToken(token: string): Promise<InviteTarget | null> {
  const [row] = await db
    .select({
      userId: users.id,
      name: users.name,
      projectId: users.projectId,
      projectName: projects.name,
      slug: projects.slug,
      pinHash: users.pinHash,
      failed: users.pinFailedCount,
    })
    .from(users)
    .innerJoin(projects, eq(users.projectId, projects.id))
    .where(and(eq(users.inviteTokenHash, hashInviteToken(token)), eq(users.kind, 'client')))

  if (!row?.projectId) return null
  return {
    userId: row.userId,
    name: row.name,
    projectId: row.projectId,
    projectName: row.projectName,
    slug: row.slug,
    pinHash: row.pinHash,
    attemptsLeft: Math.max(0, MAX_PIN_ATTEMPTS - row.failed),
  }
}

/**
 * 실패 1회를 적는다. 카운터가 한도에 닿으면 그 초대 링크는 잠긴다 —
 * 판정은 다음 조회의 `attemptsLeft`가 한다. 여기서는 세기만 한다.
 */
export async function recordPinFailure(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ pinFailedCount: sql`${users.pinFailedCount} + 1` })
    .where(eq(users.id, userId))
}

/** 성공했으니 카운터를 되돌린다 — '연속' 실패 5회가 기준이다. */
export async function clearPinFailures(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ pinFailedCount: 0, lastSeenAt: new Date() })
    .where(eq(users.id, userId))
}
