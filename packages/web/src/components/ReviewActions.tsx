'use client'

/**
 * 견적 조정 + 결정 버튼 — spec.md §5
 *
 * 승인 버튼 아래에는 버튼이 일으키는 비가역적 동작을 명시한다.
 * 무슨 일이 벌어지는지 모르고 누르는 승인은 게이트가 아니다.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatKrw, usdToKrw } from '@ticketree/shared/money'
import type { RequestKind } from '@ticketree/shared/kind'

export function ReviewActions({
  requestId,
  kind = 'change',
  proposedAmount,
  finalAmount,
  estimatedTokens,
  totalHours,
  reviewHours,
  spentUsd,
  similar,
  queueDepth,
  prNumber,
}: {
  requestId: string
  /** 과업내용서에는 견적이 없다 — 금액 칸을 통째로 걷는다 */
  kind?: RequestKind
  proposedAmount: number | null
  finalAmount: number | null
  estimatedTokens: number | null
  totalHours: number | null
  reviewHours: number | null
  spentUsd: number
  similar: { n: number; avgCostUsd: number }
  queueDepth: number
  /** 승인 시 머지될 Spec PR. 없으면 승인할 수 없다. */
  prNumber: number | null
}) {
  const router = useRouter()
  const [amount, setAmount] = useState(String(finalAmount ?? proposedAmount ?? ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** '명세 다시 쓰기'를 누르면 열리는 지침 입력. 지침 없이는 다시 써도 같은 결과다. */
  const [redoNote, setRedoNote] = useState<string | null>(null)

  const parsed = Number(amount.replace(/[^\d]/g, ''))

  async function decide(
    action: 'approve_spec' | 'redo_spec' | 'request_changes' | 'reject',
    comment?: string,
  ) {
    // 과업내용서에는 청구가 없다 — 금액을 요구하면 승인 자체가 막힌다
    if (action === 'approve_spec' && kind !== 'sow' && !Number.isFinite(parsed)) {
      setError('청구 금액을 확인해주세요')
      return
    }
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/admin/requests/${requestId}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        comment,
        finalAmount: kind !== 'sow' && Number.isFinite(parsed) ? parsed : undefined,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      setError(((await res.json()) as { error?: string }).error ?? '처리하지 못했어요')
      return
    }
    router.push('/admin')
    router.refresh()
  }

  return (
    <>
      <div className="card">
        <p className="ch">{kind === 'sow' ? '이 과업내용서' : '견적'}</p>
        {kind === 'sow' ? (
          <>
            <div className="est-figs">
              <div className="efrow">
                <span>여기까지 쓴 원가</span>
                <span className="ev dim">{formatKrw(usdToKrw(spentUsd))}</span>
              </div>
            </div>
            <p className="margin-note">
              과업내용서에는 청구가 없어요. 승인하면 이 범위가 계약으로 발효되고,
              이후 요청은 이 범위와 대조해 견적이 나갑니다.
            </p>
          </>
        ) : (
        <>
        <div className="est-figs">
          <div className="efrow">
            <span>예상 작업</span>
            <span className="ev">{totalHours !== null ? `${totalHours}h` : '—'}</span>
          </div>
          <div className="efrow">
            <span>검토·검수 시간</span>
            <span className="ev dim">{reviewHours !== null ? `${reviewHours}h` : '—'}</span>
          </div>
          <div className="efrow">
            <span>예상 구현 토큰</span>
            <span className="ev dim">
              {estimatedTokens ? estimatedTokens.toLocaleString('ko-KR') : '—'}
            </span>
          </div>
          <div className="efrow">
            <span>여기까지 쓴 원가</span>
            <span className="ev dim">{formatKrw(usdToKrw(spentUsd))}</span>
          </div>
          <div className="efrow total">
            <span>AI 제안가</span>
            {/* 0원은 "산출 안 됨"이 아니다 — 계약 범위 내라는 판정 결과일 수 있다 */}
            <span className="ev">{proposedAmount != null ? formatKrw(proposedAmount) : '—'}</span>
          </div>
        </div>

        <div className="price-edit">
          <label htmlFor="amount" style={{ fontSize: 12.5, color: 'var(--sub)', flex: 'none' }}>
            청구
          </label>
          <input
            id="amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="numeric"
          />
        </div>
        <p className="margin-note">
          {similar.n > 0
            ? `이 프로젝트 과거 job ${similar.n}건 평균 원가 ${formatKrw(usdToKrw(similar.avgCostUsd))}`
            : '비교할 과거 데이터가 아직 없어요'}
          <br />
          원가는 API 환산가예요 — 구독 실지출과 다릅니다
        </p>
        </>
        )}
      </div>

      {error && (
        <p style={{ color: 'var(--red)', fontSize: 13, textAlign: 'center' }}>{error}</p>
      )}

      <div className="side-actions">
        <button
          className="btn btn-primary"
          disabled={busy || prNumber === null}
          onClick={() => void decide('approve_spec')}
        >
          {kind === 'sow' ? '과업내용서 확정 · 계약 발효' : 'Spec 승인 · 개발 시작'}
        </button>
        <button
          className="btn"
          disabled={busy || prNumber === null}
          onClick={() => setRedoNote(redoNote === null ? '' : null)}
        >
          명세 다시 쓰기
        </button>
        {redoNote !== null && (
          <div className="redo-box">
            <textarea
              className="redo-input"
              rows={4}
              value={redoNote}
              onChange={(e) => setRedoNote(e.target.value)}
              placeholder="무엇이 잘못됐고 어떻게 써야 하는지 적어주세요 — 이대로 명세 담당에게 전달됩니다"
            />
            <button
              className="btn btn-primary"
              disabled={busy || !redoNote.trim()}
              onClick={() => void decide('redo_spec', redoNote.trim())}
            >
              이 지침으로 다시 쓰기
            </button>
            <p className="approve-note">
              지금 열린 명세 PR을 닫고 새 변경안을 만듭니다. 클라이언트에게는 되묻지 않아요.
            </p>
          </div>
        )}
        <button className="btn" disabled={busy} onClick={() => void decide('request_changes')}>
          클라이언트에게 되묻기
        </button>
        <button className="btn btn-danger" disabled={busy} onClick={() => void decide('reject')}>
          반려
        </button>
        {/* 버튼이 일으키는 비가역적 동작을 명시한다 (§5) */}
        <p className="approve-note">
          {prNumber === null ? (
            '명세 변경안이 준비되면 승인할 수 있어요'
          ) : (
            <>
              승인하면 <strong>PR #{prNumber}가 머지되고</strong>
              <br />
              {kind === 'sow' ? (
                <>
                  이 범위가 계약으로 발효됩니다
                  <br />
                  <span style={{ color: 'var(--amber)' }}>
                    이후 요청은 이 범위 안이면 추가 비용 없이 진행됩니다
                  </span>
                </>
              ) : (
                <>청구 금액이 확정됩니다 (현재 큐 {queueDepth}건)</>
              )}
            </>
          )}
        </p>
      </div>
    </>
  )
}
