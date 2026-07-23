import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { clientNote, jobs, sowStageOf, type RequestFlag, type RequestStatus } from '@ticketree/shared'
import { requestTag } from '@ticketree/shared/kind'
import { db, getSow, getThread } from '@/lib/data'
import { requireProjectAccess } from '@/lib/scope'
import { clientPath } from '@/lib/routes'
import { TopBar } from '@/components/TopBar'
import { BigSowTrack } from '@/components/StageTrack'
import { SowCard } from '@/components/SowCard'
import { Thread } from '@/components/Thread'

export const dynamic = 'force-dynamic'

export default async function SowPage({
  params,
}: {
  params: Promise<{ slug: string; sowNo: string }>
}) {
  const { slug, sowNo } = await params
  const { session, project, canAct } = await requireProjectAccess(slug)

  const n = Number(sowNo)
  if (!Number.isInteger(n)) notFound()

  const sow = await getSow(project.id, n)
  if (!sow) notFound()

  const messages = await getThread(sow.id)

  const active = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.requestId, sow.id), eq(jobs.status, 'running')))
    .limit(1)
  const queued = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.requestId, sow.id), eq(jobs.status, 'queued')))
    .limit(1)

  const busy = active.length > 0 || queued.length > 0
  const status = sow.status as RequestStatus
  const flag = sow.flag as RequestFlag | null
  const stage = sowStageOf(status)
  const tag = requestTag('sow', sow.reqNo)

  const latestAgent = [...messages].reverse().find((m) => m.role === 'agent')
  const payload = latestAgent?.payload
  const doc = payload && 'sow' in payload ? payload.sow : undefined
  const canConfirm = status === 'draft' && payload?.outcome === 'ready'

  return (
    <>
      <TopBar
        projectName={project.name}
        userName={session.name}
        slug={slug}
        canAct={canAct}
        active="sow"
      />
      <main className="wrap">
        <Link className="back" href={clientPath.sows(slug)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          과업내용서
        </Link>

        <div className="detail-head">
          <div className="row1">
            <div>
              <div className="tno-big">{tag}</div>
              <h2>{sow.title ?? '정리 중인 과업'}</h2>
              <p className="when">
                {sow.createdAt.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} 시작
                · {clientNote(status, flag, 'sow')}
              </p>
            </div>
            <span
              className={`pill ${flag === 'escalated' ? 'red' : sow.yourTurn ? 'amber' : status === 'sow_active' ? 'green' : 'green'}`}
            >
              {flag === 'escalated'
                ? '확인 중'
                : status === 'draft'
                  ? canConfirm
                    ? '확정 대기'
                    : '내용 정리 중'
                  : status === 'sow_active'
                    ? '계약 발효'
                    : clientNote(status, flag, 'sow')}
            </span>
          </div>
          {stage && <BigSowTrack stage={stage} />}
        </div>

        {/* 발효된 계약은 대화보다 내용이 먼저다 — 여기가 "무엇을 만들기로 했나"의 정본이다 */}
        {status === 'sow_active' && doc && (
          <div style={{ marginBottom: 16 }}>
            <SowCard sow={doc} tag={tag} />
          </div>
        )}

        <Thread
          requestId={sow.id}
          kind="sow"
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
          quote={null}
        />
      </main>
    </>
  )
}
