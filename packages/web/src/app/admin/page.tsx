import { redirect } from 'next/navigation'
import { costRatio, formatKrw, usdToKrw } from '@ticketree/shared/money'
import { getSession } from '@/lib/session'
import { ledger, listQueue, noticeItems } from '@/lib/admin'
import { AdminTopBar } from '@/components/AdminTopBar'
import { AdminQueue } from '@/components/AdminQueue'

export const dynamic = 'force-dynamic'

export default async function AdminHome() {
  const session = await getSession()
  if (session?.kind !== 'admin') redirect('/admin/login')

  const [rows, l, notices] = await Promise.all([listQueue(), ledger(), noticeItems()])
  const pending = rows.filter((r) => ['answer', 'spec', 'deploy'].includes(r.decision)).length

  return (
    <>
      <AdminTopBar userName={session.name} running={l.running} queued={l.queued} notices={notices} />
      <main className="wrap admin">
        <div className="page-head">
          <div>
            <h1>검토 큐</h1>
            <p className="sub">내 결정을 기다리는 순서대로 정렬되어 있어요</p>
          </div>
        </div>

        <div className="ledger four">
          <div>
            <div className="k">
              <span className="dot-amber" />
              검토 대기
            </div>
            <div className="v">
              {pending}
              <small>건</small>
            </div>
          </div>
          <div>
            <div className="k">
              <span className="dot-green" />
              실행 중 job
            </div>
            <div className="v">
              {l.running}
              <small>대기 {l.queued}건</small>
            </div>
          </div>
          <div>
            <div className="k">오늘 AI 원가(환산)</div>
            <div className="v">
              {formatKrw(usdToKrw(l.todayCostUsd))}
              <small>job {l.todayJobs}회</small>
            </div>
          </div>
          <div>
            <div className="k">이번 달 확정 견적</div>
            <div className="v">
              {formatKrw(l.monthTotal)}
              <small>
                {(() => {
                  const ratio = costRatio(l.monthTotal, l.monthCostUsd)
                  return ratio === null ? `${l.monthCount}건` : `원가율 ${ratio.toFixed(1)}%`
                })()}
              </small>
            </div>
          </div>
        </div>

        <AdminQueue rows={rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }))} />
      </main>
    </>
  )
}
