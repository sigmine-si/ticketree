'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatKrw, usdToKrw } from '@ticketree/shared/money'
import { requestTag, type RequestKind } from '@ticketree/shared/kind'
import { DECISION_LABEL, DECISION_TONE, type Decision } from '@/lib/decision'
import { adminPath } from '@/lib/routes'

export interface QueueRowView {
  id: string
  kind: RequestKind
  reqNo: number | null
  title: string | null
  projectName: string
  clientName: string
  /** 상세 주소를 만든다 — /admin/{slug}/requests/{id} */
  projectSlug: string
  decision: Decision
  note: string
  updatedAt: string
  finalAmount: number | null
  proposedAmount: number | null
  costUsd: number
}

type Tab = 'pending' | 'active' | 'all'

const PENDING: Decision[] = ['answer', 'spec', 'deploy']

export function AdminQueue({ rows }: { rows: QueueRowView[] }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('pending')

  // 진행 중인 job이 있으면 갱신한다 — 큐는 관리자가 계속 띄워두는 화면이다
  const anyRunning = rows.some((r) => r.decision === 'running')
  useEffect(() => {
    if (!anyRunning) return
    const t = setInterval(() => router.refresh(), 6000)
    return () => clearInterval(t)
  }, [anyRunning, router])

  const counts = {
    pending: rows.filter((r) => PENDING.includes(r.decision)).length,
    active: rows.filter((r) => r.decision !== 'done').length,
    all: rows.length,
  }
  const shown =
    tab === 'pending'
      ? rows.filter((r) => PENDING.includes(r.decision))
      : tab === 'active'
        ? rows.filter((r) => r.decision !== 'done')
        : rows

  return (
    <>
      <div className="tabs" role="tablist">
        {(
          [
            ['pending', '검토 대기'],
            ['active', '진행 중'],
            ['all', '전체'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            className={`tab${tab === k ? ' on' : ''}`}
            role="tab"
            onClick={() => setTab(k)}
          >
            {label}
            <span className="n">{counts[k]}</span>
          </button>
        ))}
      </div>

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th className="tno">번호</th>
              <th className="proj-cell">프로젝트</th>
              <th>요청</th>
              <th className="act-cell">필요한 결정</th>
              <th className="r amt">견적 · 원가</th>
              <th className="r upd">업데이트</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr style={{ cursor: 'default' }}>
                <td colSpan={6}>
                  <div className="empty">
                    {tab === 'pending'
                      ? '지금 내려야 할 결정이 없어요'
                      : '해당하는 요청이 없어요'}
                  </div>
                </td>
              </tr>
            ) : (
              shown.map((r) => (
                <tr
                  key={r.id}
                  tabIndex={0}
                  onClick={() => router.push(adminPath.request(r.projectSlug, r.id))}
                  onKeyDown={(e) =>
                    e.key === 'Enter' && router.push(adminPath.request(r.projectSlug, r.id))
                  }
                >
                  <td className="tno">{requestTag(r.kind, r.reqNo)}</td>
                  <td className="proj-cell">
                    <div className="p">{r.projectName}</div>
                    <div className="c">{r.clientName}</div>
                  </td>
                  <td className="ttl">
                    {PENDING.includes(r.decision) && (
                      <span className={`need${r.decision === 'answer' ? ' err' : ''}`} />
                    )}
                    {r.title ?? '확인 중인 요청'}
                    <span className="meta">
                      {r.decision === 'answer' ? <span className="warn">{r.note}</span> : r.note}
                    </span>
                  </td>
                  <td className="act-cell">
                    <span className={`chip-act ${DECISION_TONE[r.decision]}`}>
                      {DECISION_LABEL[r.decision]}
                    </span>
                  </td>
                  <td className="r amt">
                    {(r.finalAmount ?? r.proposedAmount) != null ? (
                      <>
                        {formatKrw(r.finalAmount ?? r.proposedAmount!)}
                        <span className="cost">
                          원가 {r.costUsd > 0 ? formatKrw(usdToKrw(r.costUsd)) : '—'}
                        </span>
                      </>
                    ) : (
                      <span className="tbd">산출 중</span>
                    )}
                  </td>
                  <td className="r upd">{relative(r.updatedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="tfoot">
          <span>
            {rows.length}건 중 {shown.length}건 표시
          </span>
          <span>정렬: 결정 필요 우선</span>
        </div>
      </div>
    </>
  )
}

function relative(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
}
