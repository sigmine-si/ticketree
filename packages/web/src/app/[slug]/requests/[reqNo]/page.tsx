import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import {
  clientNote,
  jobs,
  stageOf,
  type EstimationResult,
  type RequestFlag,
  type RequestStatus,
  type ScopeBasis,
  type ScopeVerdict,
} from '@ticketree/shared'
import { db, getEstimate, getRequest, getThread } from '@/lib/data'
import { requireProjectAccess } from '@/lib/scope'
import { clientPath } from '@/lib/routes'
import { TopBar } from '@/components/TopBar'
import { BigTrack } from '@/components/StageTrack'
import { Thread } from '@/components/Thread'

export const dynamic = 'force-dynamic'

export default async function RequestPage({
  params,
}: {
  params: Promise<{ slug: string; reqNo: string }>
}) {
  const { slug, reqNo } = await params
  const { session, project, canAct } = await requireProjectAccess(slug)

  const n = Number(reqNo)
  if (!Number.isInteger(n)) notFound()

  const request = await getRequest(project.id, n)
  if (!request) notFound()

  const messages = await getThread(request.id)

  const active = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.requestId, request.id), eq(jobs.status, 'running')))
    .limit(1)
  const queued = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.requestId, request.id), eq(jobs.status, 'queued')))
    .limit(1)

  const busy = active.length > 0 || queued.length > 0
  const status = request.status as RequestStatus
  const flag = request.flag as RequestFlag | null
  const stage = stageOf(status)

  const latestAgent = [...messages].reverse().find((m) => m.role === 'agent')
  const canConfirm = status === 'draft' && latestAgent?.payload?.outcome === 'ready'

  // 스레드에는 과업내용서 결과도 실릴 수 있다 — 여기는 요청 화면이라 변경 요약만 본다
  const payload = latestAgent?.payload
  const summary = payload && 'summary' in payload ? payload.summary : undefined

  // 확정 견적 승인 대기 — 클라이언트 게이트 (§7)
  const estimate = status === 'quote_ready' ? await getEstimate(request.id) : null
  const amount = estimate?.finalAmount ?? estimate?.proposedAmount ?? null

  // 범위 판정. 계약이 없는 프로젝트는 verdict가 null이고 화면이 이전 그대로다.
  const estimation = (estimate?.wbs ?? null) as EstimationResult | null
  const wbs = estimation?.wbs ?? []
  const quote =
    estimate && amount !== null
      ? {
          amount,
          days: estimate.estimatedDays,
          scope: summary?.scope ?? [],
          verdict: (estimate.scopeVerdict as ScopeVerdict | null) ?? null,
          clientNote: estimate.scopeClientNote,
          coveredAmount: estimate.coveredAmount,
          basis: (estimate.scopeBasis ?? []) as ScopeBasis[],
          coveredTasks: wbs.filter((w) => w.covered).map((w) => w.task),
          billableTasks: wbs.filter((w) => !w.covered).map((w) => w.task),
        }
      : null

  return (
    <>
      <TopBar projectName={project.name} userName={session.name} slug={slug} canAct={canAct} />
      <main className="wrap">
        <Link className="back" href={clientPath.requests(slug)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          요청 내역
        </Link>

        <div className="detail-head">
          <div className="row1">
            <div>
              <div className="tno-big">REQ-{String(n).padStart(3, '0')}</div>
              <h2>{request.title ?? '확인 중인 요청'}</h2>
              <p className="when">
                {request.createdAt.toLocaleDateString('ko-KR', {
                  month: 'long',
                  day: 'numeric',
                })}{' '}
                요청 · {clientNote(status, flag)}
              </p>
            </div>
            <span className={`pill ${flag === 'escalated' ? 'red' : request.yourTurn ? 'amber' : 'green'}`}>
              {flag === 'escalated'
                ? '확인 중'
                : status === 'draft'
                  ? canConfirm
                    ? '확정 대기'
                    : '내용 확인 중'
                  : clientNote(status, flag)}
            </span>
          </div>
          {stage && <BigTrack stage={stage} />}
        </div>

        <Thread
          requestId={request.id}
          messages={messages.map((m) => ({
            ...m,
            createdAt: m.createdAt.toISOString(),
            questions: m.questions.map((q) => ({
              ...q,
              answeredAt: q.answeredAt ? q.answeredAt.toISOString() : null,
            })),
          }))}
          clientName={session.name}
          projectName={project.name}
          busy={busy}
          canAct={canAct}
          canConfirm={canConfirm}
          quote={quote}
        />
      </main>
    </>
  )
}
