'use client'

/**
 * 에스컬레이션 답변 — spec.md §5
 *
 * 에이전트가 멈춰 세운 문제에 사람이 해석을 준다.
 * 보내면 플래그가 걷히고 에이전트가 그 해석을 들고 다시 돈다.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function EscalationAnswer({
  requestId,
  question,
}: {
  requestId: string
  question: string | null
}) {
  const router = useRouter()
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    if (!answer.trim()) {
      setError('해석을 입력해주세요')
      return
    }
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/admin/requests/${requestId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: answer.trim() }),
    })
    setBusy(false)
    if (!res.ok) {
      setError(((await res.json()) as { error?: string }).error ?? '보내지 못했어요')
      return
    }
    setAnswer('')
    router.refresh()
  }

  return (
    <div className="card">
      <p className="ch" style={{ color: 'var(--red)' }}>
        에이전트가 멈춰 세운 문제
      </p>
      <p className="cs">해석을 주면 이 답을 들고 다시 진행해요</p>

      {question && (
        <div className="callout" style={{ marginBottom: 14 }}>
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
            <path d="M12 9v4M12 17h.01" />
            <circle cx="12" cy="12" r="9" />
          </svg>
          <div>{question}</div>
        </div>
      )}

      <div className="answer-box">
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="예: 명세가 맞습니다. 코드 쪽이 잘못된 거라 이번 작업에서 함께 고쳐주세요."
        />
        {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}
        <button className="btn btn-primary" disabled={busy} onClick={() => void send()}>
          {busy ? '보내는 중…' : '해석 보내고 재개'}
        </button>
      </div>
    </div>
  )
}
