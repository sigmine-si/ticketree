'use client'

/**
 * 과업내용서 목록 — 계약 단위로 쌓인다.
 *
 * 요청 목록(RequestList)을 재사용하지 않는다. 저쪽의 "답변이 필요한 요청 N건",
 * "이번 달 확정 견적", 4단계 트랙이 계약에는 하나도 안 맞는다.
 * 공유하는 건 CSS와 시간 표기뿐이다.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  clientNote,
  SOW_STAGE_LABEL,
  sowStageOf,
  type RequestFlag,
  type RequestStatus,
} from '@ticketree/shared/status'
import { requestTag } from '@ticketree/shared/kind'
import { clientPath } from '@/lib/routes'
import { SowTrack } from './StageTrack'
import { NewSowModal } from './NewSowModal'

export interface SowRowView {
  id: string
  reqNo: number | null
  title: string | null
  status: RequestStatus
  flag: RequestFlag | null
  yourTurn: boolean
  updatedAt: string
  confirmedAt: string | null
  runningStatusText: string | null
  scopeCount: number
}

export function SowList({
  rows,
  slug,
  /** false면 관리자 열람 — 새 과업내용서는 클라이언트만 시작한다 */
  canAct = true,
}: {
  rows: SowRowView[]
  slug: string
  canAct?: boolean
}) {
  const router = useRouter()
  const [modal, setModal] = useState(false)

  const anyBusy = rows.some((r) => r.runningStatusText !== null || r.status === 'draft')
  useEffect(() => {
    if (!anyBusy) return
    const t = setInterval(() => router.refresh(), 6000)
    return () => clearInterval(t)
  }, [anyBusy, router])

  const active = rows.filter((r) => r.status === 'sow_active').length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>과업내용서</h1>
          <p className="sub">
            {active > 0
              ? '무엇을 만들기로 했는지 여기에 남아요 — 요청이 이 범위 안인지 밖인지의 기준이 됩니다'
              : '무엇을 만들지 함께 정리해서 계약 범위를 정해요'}
          </p>
        </div>
        {canAct && (
          <button className="btn btn-primary" onClick={() => setModal(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            새 과업내용서
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="card" style={{ borderStyle: 'dashed', textAlign: 'center', padding: 32 }}>
          <p className="ch" style={{ marginBottom: 6 }}>
            아직 과업내용서가 없어요
          </p>
          <p className="cs" style={{ marginBottom: canAct ? 18 : 0 }}>
            무엇을 만들지부터 정해요. 담당자가 몇 가지 여쭤보고 과업 범위·산출물·일정·검수
            기준까지 정리해드립니다. 확정하면 그대로 서비스 명세가 돼요.
          </p>
          {canAct && (
            <button className="btn btn-primary" onClick={() => setModal(true)}>
              과업내용서 만들기
            </button>
          )}
        </div>
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th className="tno">번호</th>
                <th>과업</th>
                <th className="stage-cell">진행</th>
                <th className="r amt">범위</th>
                <th className="r upd">업데이트</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <SowRow
                  key={r.id}
                  row={r}
                  onOpen={() => router.push(clientPath.sow(slug, r.reqNo ?? 0))}
                />
              ))}
            </tbody>
          </table>
          <div className="tfoot">
            <span>
              {rows.length}건 · 발효 중 {active}건
            </span>
          </div>
        </div>
      )}

      {modal && <NewSowModal onClose={() => setModal(false)} />}
    </>
  )
}

function SowRow({ row, onOpen }: { row: SowRowView; onOpen: () => void }) {
  const stage = sowStageOf(row.status)
  const busy = row.runningStatusText !== null
  const note = clientNote(row.status, row.flag, 'sow')

  return (
    <tr tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <td className="tno">{row.reqNo !== null ? requestTag('sow', row.reqNo) : '—'}</td>
      <td className="ttl">
        {row.yourTurn && <span className="need" />}
        {row.flag === 'escalated' && <span className="need err" />}
        {row.title ?? '정리 중인 과업'}
        <span className="meta">{busy ? row.runningStatusText : note}</span>
      </td>
      <td className="stage-cell">
        {stage === null || busy ? (
          <div className="stage-busy">
            <span className="spin" role="status" aria-label="확인 중" />
            {busy ? '정리 중' : '대기'}
          </div>
        ) : (
          <>
            <SowTrack stage={stage} yourTurn={row.yourTurn} />
            <span
              className={`stage-label${row.yourTurn ? ' wait' : stage === 'active' ? ' fin' : ''}`}
            >
              {row.yourTurn && row.status === 'awaiting_client' ? '답변 필요' : SOW_STAGE_LABEL[stage]}
            </span>
          </>
        )}
      </td>
      <td className="r amt">
        {row.scopeCount > 0 ? `${row.scopeCount}건` : <span className="tbd">정리 중</span>}
      </td>
      <td className="r upd">{relative(row.updatedAt)}</td>
    </tr>
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
