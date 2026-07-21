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

export function ReviewActions({
  requestId,
  proposedAmount,
  finalAmount,
  estimatedTokens,
  totalHours,
  reviewHours,
  spentUsd,
  similar,
  queueDepth,
}: {
  requestId: string
  proposedAmount: number | null
  finalAmount: number | null
  estimatedTokens: number | null
  totalHours: number | null
  reviewHours: number | null
  spentUsd: number
  similar: { n: number; avgCostUsd: number }
  queueDepth: number
}) {
  const router = useRouter()
  const [amount, setAmount] = useState(String(finalAmount ?? proposedAmount ?? ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsed = Number(amount.replace(/[^\d]/g, ''))

  async function decide(action: 'approve_spec' | 'request_changes' | 'reject') {
    if (action === 'approve_spec' && !Number.isFinite(parsed)) {
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
        finalAmount: Number.isFinite(parsed) ? parsed : undefined,
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
        <p className="ch">견적</p>
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
            <span className="ev">{proposedAmount ? formatKrw(proposedAmount) : '—'}</span>
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
      </div>

      {error && (
        <p style={{ color: 'var(--red)', fontSize: 13, textAlign: 'center' }}>{error}</p>
      )}

      <div className="side-actions">
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void decide('approve_spec')}
        >
          Spec 승인 · 개발 시작
        </button>
        <button className="btn" disabled={busy} onClick={() => void decide('request_changes')}>
          수정 요청
        </button>
        <button className="btn btn-danger" disabled={busy} onClick={() => void decide('reject')}>
          반려
        </button>
        <p className="approve-note">
          승인하면 청구 금액이 확정되고
          <br />
          구현 대기로 넘어갑니다 (현재 큐 {queueDepth}건)
          <br />
          <span style={{ color: 'var(--amber)' }}>
            Spec PR 머지와 구현 job 등록은 슬라이스 3·4에서 붙습니다
          </span>
        </p>
      </div>
    </>
  )
}
