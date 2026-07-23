'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
// 클라이언트 컴포넌트는 barrel(@ticketree/shared)을 쓰지 않는다 —
// barrel이 db/client를 끌고 오면 pg가 브라우저 번들에 들어간다.
import {
  clientNote,
  isClientTurn,
  stageOf,
  STAGE_LABEL,
  type RequestFlag,
  type RequestStatus,
  type Stage,
} from '@ticketree/shared/status'
import { clientPath } from '@/lib/routes'
import { StageTrack } from './StageTrack'
import { NewRequestModal } from './NewRequestModal'

export interface Row {
  id: string
  reqNo: number | null
  title: string | null
  status: RequestStatus
  flag: RequestFlag | null
  yourTurn: boolean
  updatedAt: string
  roughMin: number | null
  roughMax: number | null
  finalAmount: number | null
  scopeVerdict: string | null
  runningStatusText: string | null
}

type Filter = 'all' | 'need' | 'run' | 'fin'

function filterOf(r: Row): Filter {
  if (r.status === 'deployed') return 'fin'
  if (r.yourTurn) return 'need'
  return 'run'
}

export function RequestList({
  rows,
  slug,
  /** false면 관리자 열람 — 새 요청은 클라이언트만 낸다 */
  canAct = true,
}: {
  rows: Row[]
  slug: string
  canAct?: boolean
}) {
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>('all')
  const [modal, setModal] = useState(false)

  const counts = {
    all: rows.length,
    need: rows.filter((r) => filterOf(r) === 'need').length,
    run: rows.filter((r) => filterOf(r) === 'run').length,
    fin: rows.filter((r) => filterOf(r) === 'fin').length,
  }
  const shown = filter === 'all' ? rows : rows.filter((r) => filterOf(r) === filter)
  const monthTotal = rows.reduce((s, r) => s + (r.finalAmount ?? 0), 0)

  // 진행 중인 요청이 있을 때만 폴링한다 (§13 — 5~10초).
  // 전부 멈춰 있으면 두드릴 이유가 없다.
  const anyBusy = rows.some((r) => r.runningStatusText !== null || r.status === 'draft')
  useEffect(() => {
    if (!anyBusy) return
    const t = setInterval(() => router.refresh(), 6000)
    return () => clearInterval(t)
  }, [anyBusy, router])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>요청 내역</h1>
          <p className="sub">클릭하면 대화와 견적을 확인할 수 있어요</p>
        </div>
        {canAct && (
          <button className="btn btn-primary" onClick={() => setModal(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            새 요청
          </button>
        )}
      </div>

      <div className="ledger">
        <div
          role="button"
          tabIndex={0}
          style={{ cursor: 'pointer' }}
          onClick={() => setFilter('need')}
        >
          <div className="k">
            <span className="dot-amber" />
            답변이 필요한 요청
          </div>
          <div className="v">
            {counts.need}
            <small>건 — 답변하면 바로 진행돼요</small>
          </div>
        </div>
        <div>
          <div className="k">
            <span className="dot-green" />
            진행 중
          </div>
          <div className="v">
            {counts.run}
            <small>건</small>
          </div>
        </div>
        <div>
          <div className="k">이번 달 확정 견적</div>
          <div className="v">
            ₩{monthTotal.toLocaleString('ko-KR')}
            {/* 0원(계약 범위 내)도 확정된 견적이다 — falsy로 세면 빠진다 */}
            <small>{rows.filter((r) => r.finalAmount != null).length}건</small>
          </div>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {(
          [
            ['all', '전체'],
            ['need', '답변 필요'],
            ['run', '진행 중'],
            ['fin', '완료'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            className={`tab${filter === k ? ' on' : ''}`}
            role="tab"
            onClick={() => setFilter(k)}
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
              <th>요청</th>
              <th className="stage-cell">진행</th>
              <th className="r amt">견적</th>
              <th className="r upd">업데이트</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr style={{ cursor: 'default' }}>
                <td colSpan={5}>
                  <div className="empty">
                    {rows.length > 0
                      ? '이 조건에 해당하는 요청이 없어요'
                      : canAct
                        ? '아직 요청이 없어요 — 오른쪽 위 “새 요청”으로 시작해보세요'
                        : '아직 요청이 없어요'}
                  </div>
                </td>
              </tr>
            ) : (
              shown.map((r) => (
                <RequestRow
                  key={r.id}
                  row={r}
                  onOpen={() => router.push(clientPath.request(slug, r.reqNo ?? 0))}
                />
              ))
            )}
          </tbody>
        </table>
        <div className="tfoot">
          <span>
            {rows.length}건 중 {shown.length}건 표시
          </span>
        </div>
      </div>

      {modal && <NewRequestModal onClose={() => setModal(false)} />}
    </>
  )
}

function RequestRow({ row, onOpen }: { row: Row; onOpen: () => void }) {
  const stage = stageOf(row.status)
  const note = clientNote(row.status, row.flag)
  const busy = row.runningStatusText !== null

  return (
    <tr tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <td className="tno">{row.reqNo ?? '—'}</td>
      <td className="ttl">
        {row.yourTurn && <span className="need" />}
        {row.flag === 'escalated' && <span className="need err" />}
        {row.title ?? '확인 중인 요청'}
        <span className="meta">{busy ? row.runningStatusText : note}</span>
      </td>
      <td className="stage-cell">
        {/* draft는 아직 티켓이 아니라 트랙을 그리지 않는다 (§7) */}
        {stage === null || busy ? (
          <div className="stage-busy">
            <span className="spin" role="status" aria-label="확인 중" />
            {busy ? '확인 중' : '접수 대기'}
          </div>
        ) : (
          <>
            <StageTrack stage={stage} yourTurn={row.yourTurn} />
            <span
              className={`stage-label${row.yourTurn ? ' wait' : stage === 'deployed' ? ' fin' : ''}`}
            >
              {stageLabelOf(row, stage)}
            </span>
          </>
        )}
      </td>
      <td className="r amt">
        {/* 계약 범위 내라 0원인 것과 아직 안 나온 것은 다르다 */}
        {row.scopeVerdict === 'included' ? (
          <span className="pill green">추가 비용 없음</span>
        ) : row.finalAmount != null ? (
          `₩${row.finalAmount.toLocaleString('ko-KR')}`
        ) : row.roughMin != null && row.roughMax != null ? (
          <span className="range">
            {Math.round(row.roughMin / 10000)}~{Math.round(row.roughMax / 10000)}만
          </span>
        ) : (
          <span className="tbd">산출 중</span>
        )}
      </td>
      <td className="r upd">{relative(row.updatedAt)}</td>
    </tr>
  )
}

/**
 * 진행 라벨. 플래그가 status를 이긴다 — 에스컬레이션 중인 요청에
 * "답변 필요"가 뜨면 클라이언트가 자기 차례라고 오해한다.
 */
function stageLabelOf(row: Row, stage: Stage): string {
  if (row.flag === 'escalated') return '확인 중'
  if (row.flag === 'on_hold') return '보류'
  if (row.flag === 'cancelled') return '취소됨'
  if (row.yourTurn && isClientTurn(row.status)) {
    if (row.status === 'awaiting_client') return '답변 필요'
    if (row.status === 'quote_ready') return '견적 확인'
    return '미리보기 확인'
  }
  return STAGE_LABEL[stage]
}

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
}
