'use client'

/**
 * 범위 판정 조정 — 클라이언트가 견적을 승인하기 **전에만** 열린다.
 *
 * AI가 "추가 비용 없습니다"를 내보낸 뒤에 금액을 매기면 조정이 아니라 번복이다.
 * 그래서 견적 확정(finalAmount)과 별개의 자리다.
 *
 * 판정을 뒤집는 순간 그건 AI의 추정이 아니라 회사의 약속이 된다 —
 * 그래서 클라이언트가 읽을 문장을 직접 쓰게 하고, 서명(누가 바꿨나)을 남긴다.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SCOPE_VERDICTS, type ScopeVerdict } from '@ticketree/shared/agent-io'

const LABEL: Record<ScopeVerdict, string> = {
  included: '계약 범위 안 — 청구 안 함',
  partial: '일부만 포함 — 초과분만 청구',
  out_of_scope: '계약 범위 밖 — 전액 청구',
}

export function ScopeOverride({
  requestId,
  verdict,
  proposedAmount,
  coveredAmount,
  clientNote,
  /** 클라이언트가 이견을 낸 상태면 접어두지 않고 펼친 채로 시작한다 */
  disputed = false,
}: {
  requestId: string
  verdict: ScopeVerdict | null
  proposedAmount: number | null
  coveredAmount: number | null
  clientNote: string | null
  disputed?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(disputed)
  const [v, setV] = useState<ScopeVerdict>(verdict ?? 'out_of_scope')
  const [amount, setAmount] = useState(String(proposedAmount ?? ''))
  const [covered, setCovered] = useState(String(coveredAmount ?? ''))
  const [note, setNote] = useState(clientNote ?? '')
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/admin/requests/${requestId}/scope`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verdict: v,
        proposedAmount: v === 'included' ? 0 : Number(amount.replace(/[^\d]/g, '') || 0),
        coveredAmount: Number(covered.replace(/[^\d]/g, '') || 0),
        clientNote: note.trim(),
        overrideNote: why.trim(),
      }),
    })
    setBusy(false)
    if (!res.ok) {
      setError(((await res.json()) as { error?: string }).error ?? '처리하지 못했어요')
      return
    }
    setOpen(false)
    router.refresh()
  }

  return (
    <div className="card">
      <p className="ch">범위 판정 조정</p>
      <p className="cs">
        {disputed
          ? '클라이언트가 이견을 냈어요 — 계약서와 대조해 다시 판단해주세요'
          : '클라이언트가 승인하기 전까지만 고칠 수 있어요'}
      </p>

      {!open ? (
        <button className="btn" onClick={() => setOpen(true)}>
          판정 바꾸기
        </button>
      ) : (
        <>
          <div className="chips" style={{ marginBottom: 12 }}>
            {SCOPE_VERDICTS.map((k) => (
              <button
                key={k}
                className={`chip${v === k ? ' sel' : ''}`}
                onClick={() => setV(k)}
                disabled={busy}
              >
                {LABEL[k]}
              </button>
            ))}
          </div>

          {v !== 'included' && (
            <div className="price-edit">
              <label htmlFor="sc-amt" style={{ fontSize: 12.5, color: 'var(--sub)', flex: 'none' }}>
                청구
              </label>
              <input
                id="sc-amt"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="numeric"
              />
            </div>
          )}

          <div className="price-edit" style={{ marginTop: 8 }}>
            <label htmlFor="sc-cov" style={{ fontSize: 12.5, color: 'var(--sub)', flex: 'none' }}>
              커버분
            </label>
            <input
              id="sc-cov"
              value={covered}
              onChange={(e) => setCovered(e.target.value)}
              inputMode="numeric"
            />
          </div>

          <div className="redo-box" style={{ marginTop: 12 }}>
            <textarea
              className="redo-input"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="클라이언트가 그대로 읽을 문장 — 왜 이렇게 되는지 계약서를 근거로 설명해주세요"
            />
            <textarea
              className="redo-input"
              rows={2}
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              placeholder="내부 기록 — 왜 판정을 바꿨는지"
            />
            {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}
            <button
              className="btn btn-primary"
              disabled={busy || !note.trim() || !why.trim()}
              onClick={submit}
            >
              이 판정으로 고치기
            </button>
            <p className="approve-note">
              바꾸면 클라이언트 화면의 설명이 위 문장으로 대체되고,
              <br />
              누가 바꿨는지가 기록에 남습니다.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
