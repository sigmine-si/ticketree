import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { formatKrw, usdToKrw } from '@ticketree/shared/money'
import type { RequestFlag, RequestStatus } from '@ticketree/shared/status'
import { getSession } from '@/lib/session'
import { getReviewDetail, ledger } from '@/lib/admin'
import { adminPath } from '@/lib/routes'
import { decisionOf, DECISION_LABEL } from '@/lib/decision'
import { AdminTopBar } from '@/components/AdminTopBar'
import { ReviewActions } from '@/components/ReviewActions'
import { DeployActions } from '@/components/DeployActions'
import { EscalationAnswer } from '@/components/EscalationAnswer'
import { SpecDiff } from '@/components/SpecDiff'

export const dynamic = 'force-dynamic'

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>
}) {
  const session = await getSession()
  if (session?.kind !== 'admin') redirect('/admin/login')

  const { slug, id } = await params
  const [detail, l] = await Promise.all([getReviewDetail(id), ledger()])
  if (!detail) notFound()
  // 주소의 프로젝트와 요청의 프로젝트가 어긋나면 없는 주소다 — 잘못된 링크가
  // 그럴듯한 화면을 띄우면 어느 프로젝트 건인지 착각한 채 승인하게 된다
  if (detail.project.slug !== slug) notFound()

  const { request, project, intake, estimation, estimate, qa, jobs, similar, specPr, codePr } =
    detail
  const status = request.status as RequestStatus
  const flag = request.flag as RequestFlag | null
  const decision = decisionOf(status, flag, false)
  const spentUsd = jobs.reduce((s, j) => s + (j.costUsd ?? 0), 0)

  return (
    <>
      <AdminTopBar userName={session.name} running={l.running} queued={l.queued} />
      <main className="wrap admin">
        <Link className="back" href={adminPath.queue}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          검토 큐
        </Link>

        <div className="detail-head" style={{ marginBottom: 14 }}>
          <div className="row1">
            <div>
              <div className="tno-big">
                REQ-{String(request.reqNo ?? 0).padStart(3, '0')} · {project.name} ·{' '}
                {project.clientName}
              </div>
              <h2>{request.title ?? '확인 중인 요청'}</h2>
              <p className="when">
                {request.confirmedAt
                  ? `${request.confirmedAt.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 확정`
                  : '아직 확정 전'}
              </p>
            </div>
            <span
              className={`pill ${decision === 'answer' ? 'red' : decision === 'spec' || decision === 'deploy' ? 'amber' : 'green'}`}
            >
              {DECISION_LABEL[decision]}
            </span>
          </div>
        </div>

        <div className="detail-grid">
          <div className="dmain">
            {flag === 'escalated' && (
              <EscalationAnswer requestId={request.id} question={intake?.escalation ?? intake?.message ?? null} />
            )}

            <div className="card">
              <p className="ch">클라이언트 요청 원문</p>
              <p className="cs">여기서 시작했다</p>
              {request.asIs && (
                <p className="note" style={{ marginBottom: 10 }}>
                  <span className="ftag">AS-IS</span> {request.asIs}
                </p>
              )}
              <p className="note">
                <span className="ftag">TO-BE</span> {request.toBe}
              </p>
            </div>

            {intake && (
              <div className="card">
                <p className="ch">탐색 노트</p>
                <p className="cs">
                  접수 대화에서 에이전트가 코드를 확인한 결과 · 클라이언트에게는 안 보인다
                </p>
                <p className="note">{intake.notes}</p>
                {intake.files.length > 0 && (
                  <div className="files">
                    {intake.files.map((f) => (
                      <span className="ftag" key={f}>
                        {f}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {qa.length > 0 && (
              <div className="card">
                <p className="ch">클라이언트 문답</p>
                <p className="cs">구체화 단계에서 확정된 내용</p>
                {qa.map((x, i) => (
                  <div className="qa" key={i}>
                    <p className="q">{x.prompt}</p>
                    <p className="a">{x.answer}</p>
                  </div>
                ))}
              </div>
            )}

            {estimation && (
              <div className="card">
                <p className="ch">작업 분해</p>
                <p className="cs">{estimation.rationale}</p>
                {estimation.wbs.map((w, i) => (
                  <div className="wbs-row" key={i}>
                    <span>
                      {w.task}
                      {w.repo && <span className="ftag" style={{ marginLeft: 6 }}>{w.repo}</span>}
                    </span>
                    <span className="h">{w.hours}h</span>
                  </div>
                ))}
                {estimation.risks.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <p className="ch">위험 요소</p>
                    {estimation.risks.map((r, i) => (
                      <div className="risk" key={i}>
                        {r}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {specPr?.diff ? (
              <SpecDiff
                diff={specPr.diff}
                prNumber={specPr.number}
                url={specPr.url}
                status={specPr.status}
              />
            ) : (
              <div className="card" style={{ borderStyle: 'dashed' }}>
                <p className="ch" style={{ color: 'var(--faint)' }}>
                  Spec 변경안
                </p>
                <p className="cs" style={{ marginBottom: 0 }}>
                  명세 변경안을 만들고 있어요 — 잠시 후 이 자리에 변경 내용이 나옵니다
                </p>
              </div>
            )}

            {codePr?.diff && (
              <SpecDiff
                diff={codePr.diff}
                prNumber={codePr.number}
                url={codePr.url}
                status={codePr.status}
                title="코드 변경"
                caption={
                  status === 'in_review'
                    ? '이 코드가 명세를 만족하는지 확인하고 배포를 승인해요'
                    : '머지된 코드 변경'
                }
              />
            )}
          </div>

          <aside className="dside">
            {status === 'client_approved' ? (
              <ReviewActions
                requestId={request.id}
                proposedAmount={estimate?.proposedAmount ?? null}
                finalAmount={estimate?.finalAmount ?? null}
                estimatedTokens={estimate?.costEstimateTokens ?? null}
                totalHours={estimation?.total_hours ?? null}
                reviewHours={estimation?.review_hours ?? null}
                spentUsd={spentUsd}
                similar={similar}
                queueDepth={l.queued}
                prNumber={specPr?.number ?? null}
              />
            ) : status === 'in_review' || status === 'awaiting_manual_deploy' ? (
              <DeployActions
                requestId={request.id}
                stage={status}
                prNumber={codePr?.number ?? null}
                previewUrl={codePr?.previewUrl ?? null}
              />
            ) : (
              <div className="card">
                <p className="ch">견적</p>
                <div className="est-figs">
                  <div className="efrow">
                    <span>AI 제안가</span>
                    <span className="ev">
                      {estimate?.proposedAmount ? formatKrw(estimate.proposedAmount) : '—'}
                    </span>
                  </div>
                  <div className="efrow">
                    <span>확정 청구</span>
                    <span className="ev">
                      {estimate?.finalAmount ? formatKrw(estimate.finalAmount) : '미확정'}
                    </span>
                  </div>
                  <div className="efrow total">
                    <span>여기까지 원가</span>
                    <span className="ev">{formatKrw(usdToKrw(spentUsd))}</span>
                  </div>
                </div>
                <p className="margin-note">
                  지금은 결정할 것이 없어요 — {DECISION_LABEL[decision]}
                </p>
              </div>
            )}

            <div className="card">
              <p className="ch">이 요청의 job</p>
              {jobs.length === 0 ? (
                <p className="cs" style={{ marginBottom: 0 }}>
                  아직 실행된 job이 없어요
                </p>
              ) : (
                jobs.map((j) => (
                  <div className="jobline" key={j.id}>
                    <span className="jid">{j.id.slice(0, 8)}</span>
                    {j.kind}
                    <span className={`jv${j.status === 'done' ? ' ok' : ''}`}>
                      {j.status === 'done'
                        ? `${formatKrw(usdToKrw(j.costUsd ?? 0))}`
                        : j.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      </main>
    </>
  )
}
