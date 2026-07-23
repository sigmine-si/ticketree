/**
 * 원가 — spec.md §8
 *
 * "AI 원가(환산)"이지 구독 실지출이 아니다. 원가율은 참고 지표로만 쓴다.
 * 이 화면의 목적은 정산이 아니라 **견적 보정**이다 — 견적 대비 실제가 어땠는지
 * 요청마다 쌓아두고, 다음 견적의 근거로 삼는다.
 */
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { costRatio, formatKrw, usdToKrw } from '@ticketree/shared/money'
import { costByKind, costByRequest, ledger, noticeItems } from '@/lib/admin'
import { getSession } from '@/lib/session'
import { adminPath } from '@/lib/routes'
import { AdminTopBar } from '@/components/AdminTopBar'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  exploration: '탐색',
  intake_round: '접수 대화',
  estimation: '견적 산출',
  spec_draft: '명세 작성',
  spec_merge: '명세 머지',
  implementation: '구현',
  deploy: '배포',
  deploy_finalize: '배포 마감',
  onboarding: '온보딩',
}

function mmss(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}초`
  return `${Math.floor(sec / 60)}분 ${String(Math.round(sec % 60)).padStart(2, '0')}초`
}

export default async function CostsPage() {
  const session = await getSession()
  if (session?.kind !== 'admin') redirect('/admin/login')

  const [rows, byKind, l, notices] = await Promise.all([
    costByRequest(),
    costByKind(),
    ledger(),
    noticeItems(),
  ])

  const totalCost = rows.reduce((s, r) => s + r.costUsd, 0)
  const totalBilled = rows.reduce((s, r) => s + (r.billed ?? 0), 0)
  const ratio = costRatio(totalBilled, totalCost)

  return (
    <>
      <AdminTopBar
        userName={session.name}
        running={l.running}
        queued={l.queued}
        notices={notices}
        current="costs"
      />
      <main className="wrap admin">
        <div className="page-head">
          <div>
            <h1>원가</h1>
            <p className="sub">
              견적 대비 실제가 어땠는지 봅니다 — 금액은 API 환산가라 구독 실지출과 달라요
            </p>
          </div>
        </div>

        <div className="ledger four">
          <div>
            <div className="k">누적 AI 원가(환산)</div>
            <div className="v">
              {formatKrw(usdToKrw(totalCost))}
              <small>${totalCost.toFixed(2)}</small>
            </div>
          </div>
          <div>
            <div className="k">누적 확정 견적</div>
            <div className="v">
              {formatKrw(totalBilled)}
              <small>요청 {rows.filter((r) => r.billed !== null).length}건</small>
            </div>
          </div>
          <div>
            <div className="k">원가율(참고)</div>
            <div className="v">
              {ratio === null ? '—' : `${ratio.toFixed(1)}%`}
              <small>환산 기준</small>
            </div>
          </div>
          <div>
            <div className="k">오늘</div>
            <div className="v">
              {formatKrw(usdToKrw(l.todayCostUsd))}
              <small>job {l.todayJobs}회</small>
            </div>
          </div>
        </div>

        <div className="card">
          <p className="ch">단계별</p>
          <p className="cs">어느 단계가 비싼지 — 모델 선택이 원가를 지배합니다</p>
          <div className="sb-tablewrap">
            <table className="sb-table">
              <thead>
                <tr>
                  <th>단계</th>
                  <th>횟수</th>
                  <th>원가(환산)</th>
                  <th>평균 소요</th>
                  <th>출력 토큰</th>
                </tr>
              </thead>
              <tbody>
                {byKind.map((k) => (
                  <tr key={k.kind}>
                    <td>{KIND_LABEL[k.kind] ?? k.kind}</td>
                    <td>{k.n}</td>
                    <td>{formatKrw(usdToKrw(k.costUsd))}</td>
                    <td>{mmss(k.avgSeconds)}</td>
                    <td>{Number(k.tokensOut).toLocaleString('ko-KR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <p className="ch">요청별</p>
          <p className="cs">원가가 큰 순서예요</p>
          <div className="sb-tablewrap">
            <table className="sb-table">
              <thead>
                <tr>
                  <th>요청</th>
                  <th>확정 견적</th>
                  <th>원가(환산)</th>
                  <th>원가율</th>
                  <th>job</th>
                  <th>소요</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const rr = costRatio(r.billed ?? 0, r.costUsd)
                  return (
                    <tr key={r.requestId}>
                      <td>
                        <Link href={adminPath.request(r.projectSlug, r.requestId)}>
                          {r.reqNo === null
                            ? '(확정 전)'
                            : `REQ-${String(r.reqNo).padStart(3, '0')}`}{' '}
                          {r.title ?? ''}
                        </Link>
                        <br />
                        <span style={{ color: 'var(--faint)', fontSize: 11.5 }}>
                          {r.projectName}
                        </span>
                      </td>
                      <td>{r.billed === null ? '—' : formatKrw(r.billed)}</td>
                      <td>{formatKrw(usdToKrw(r.costUsd))}</td>
                      <td>{rr === null ? '—' : `${rr.toFixed(1)}%`}</td>
                      <td>{r.jobCount}</td>
                      <td>{mmss(r.seconds)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </>
  )
}
