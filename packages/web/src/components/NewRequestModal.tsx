'use client'

/**
 * 새 요청 모달 — spec.md §2, §4
 *
 * 보내는 즉시 draft가 생기고 탐색이 시작된다. 모달은 대화 화면으로 바뀌고
 * SSE가 버퍼링 문구를 흘린다. 언제든 닫아도 확인은 계속된다(탈출구 UX).
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { IntakeResult } from '@ticketree/shared/agent-io'
import { QuestionBlock, type ThreadQuestion } from './QuestionBlock'

interface ThreadMessage {
  id: string
  role: 'client' | 'agent' | 'system'
  content: string
  payload: IntakeResult | null
  questions: ThreadQuestion[]
}

const URGENCY = [
  { key: 'urgent', label: '급해요' },
  { key: 'this_week', label: '이번 주 안에' },
  { key: 'relaxed', label: '여유 있어요' },
] as const

export function NewRequestModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [phase, setPhase] = useState<'form' | 'chat'>('form')
  const [asIs, setAsIs] = useState('')
  const [toBe, setToBe] = useState('')
  const [urgency, setUrgency] = useState<string>('this_week')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [requestId, setRequestId] = useState<string | null>(null)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [thread, setThread] = useState<ThreadMessage[]>([])
  const chatRef = useRef<HTMLDivElement>(null)

  const latestAgent = [...thread].reverse().find((m) => m.role === 'agent')
  const ready = latestAgent?.payload?.outcome === 'ready'
  const escalated = latestAgent?.payload?.outcome === 'escalate'

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight })
  }, [thread, statusText])

  // SSE — 러너가 DB에 쓴 버퍼링 문구를 릴레이받는다
  useEffect(() => {
    if (!requestId) return
    const es = new EventSource(`/api/requests/${requestId}/stream`)

    es.addEventListener('status', (e) => {
      setStatusText(JSON.parse((e as MessageEvent).data).text)
    })
    es.addEventListener('round', () => {
      setStatusText(null)
      void refreshThread(requestId)
    })
    es.addEventListener('idle', () => setStatusText(null))
    es.onerror = () => setStatusText(null)

    return () => es.close()
  }, [requestId])

  async function refreshThread(id: string) {
    const res = await fetch(`/api/requests/${id}/thread`)
    if (!res.ok) return
    const data = (await res.json()) as { messages: ThreadMessage[] }
    setThread(data.messages)
  }

  async function submit() {
    if (!toBe.trim()) {
      setError('TO-BE 칸에 원하는 모습을 한 줄이라도 적어주세요')
      return
    }
    setBusy(true)
    setError(null)
    const res = await fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asIs: asIs.trim() || undefined, toBe: toBe.trim(), urgency }),
    })
    setBusy(false)
    if (!res.ok) {
      setError(((await res.json()) as { error?: string }).error ?? '요청을 보내지 못했어요')
      return
    }
    const { id } = (await res.json()) as { id: string }
    setRequestId(id)
    setPhase('chat')
    setStatusText('곧 확인을 시작할게요')
    router.refresh()
  }

  async function answer(q: ThreadQuestion, text: string, optionIdx: number | null) {
    if (!requestId) return
    setStatusText('답변을 반영하고 있어요')
    await fetch(`/api/requests/${requestId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: q.id, answer: text, optionIdx }),
    })
    await refreshThread(requestId)
    router.refresh()
  }

  async function confirm() {
    if (!requestId) return
    setBusy(true)
    const res = await fetch(`/api/requests/${requestId}/confirm`, { method: 'POST' })
    setBusy(false)
    if (!res.ok) {
      setError(((await res.json()) as { error?: string }).error ?? '확정하지 못했어요')
      return
    }
    router.refresh()
    onClose()
  }

  function leave() {
    router.refresh()
    onClose()
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && leave()}>
      <div className="modal" role="dialog" aria-modal="true">
        {phase === 'form' ? (
          <>
            <h3>새 요청</h3>
            <p className="msub">
              편하게 적어주세요 — 보내면 이 자리에서 몇 가지 여쭤보고 내용을 확정할게요
            </p>

            <div className="mfield">
              <label htmlFor="asis">
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--sub)' }}>
                  AS-IS
                </span>{' '}
                · 지금은 이래요 <small>선택</small>
              </label>
              <textarea
                id="asis"
                value={asIs}
                onChange={(e) => setAsIs(e.target.value)}
                placeholder="예: 포장 주문 손님이 매장에 와서야 음료가 아직 준비 안 된 걸 알게 돼요."
              />
            </div>

            <div className="mfield">
              <label htmlFor="tobe">
                <span
                  style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--green-deep)' }}
                >
                  TO-BE
                </span>{' '}
                · 이렇게 바뀌면 좋겠어요
              </label>
              <textarea
                id="tobe"
                value={toBe}
                onChange={(e) => setToBe(e.target.value)}
                placeholder="예: 음료가 준비되면 손님이 알림을 받고, 앱에서 준비 상태를 볼 수 있으면 좋겠어요."
              />
            </div>

            <div className="mfield">
              <label>언제까지 필요하세요?</label>
              <div className="chips">
                {URGENCY.map((u) => (
                  <button
                    key={u.key}
                    type="button"
                    className={`chip${urgency === u.key ? ' sel' : ''}`}
                    onClick={() => setUrgency(u.key)}
                  >
                    {u.label}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{error}</p>
            )}

            <div className="mfoot">
              <span className="hint">
                보내면 내용을 살펴보고
                <br />
                필요한 것만 바로 여쭤봐요
              </span>
              <button className="btn" onClick={leave}>
                취소
              </button>
              <button className="btn btn-primary" onClick={submit} disabled={busy}>
                {busy ? '보내는 중…' : '보내기'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>요청 확인</h3>
            <p className="msub">몇 가지 여쭤보고 내용을 확정할게요</p>

            <div className="chat" ref={chatRef}>
              <div className="msg user">
                {asIs && <span className="as">지금: {asIs}</span>}
                {toBe}
              </div>

              {thread
                .filter((m) => m.role === 'agent')
                .map((m) => (
                  <div className="msg sys" key={m.id}>
                    {m.content}
                    {m.questions.map((q) => (
                      <QuestionBlock
                        key={q.id}
                        q={q}
                        onAnswer={answer}
                        disabled={statusText !== null}
                      />
                    ))}
                    {m.payload?.outcome === 'ready' && m.payload.summary && (
                      <>
                        <div className="sum-scope" style={{ marginTop: 8 }}>
                          {m.payload.summary.scope.map((s, i) => (
                            <div key={i}>· {s}</div>
                          ))}
                        </div>
                        <div className="sum-figs">
                          <div className="sum-fig">
                            <div className="k">예상 비용</div>
                            <div className="v">
                              {formatRange(m.payload.summary.rough_min, m.payload.summary.rough_max)}
                            </div>
                          </div>
                          <div className="sum-fig">
                            <div className="k">예상 기간</div>
                            <div className="v">{m.payload.summary.estimated_days}</div>
                          </div>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--faint)' }}>
                          확정 견적은 검토 후 알려드려요
                        </div>
                      </>
                    )}
                  </div>
                ))}

              {statusText && (
                <div className="status-line">
                  <span className="spinner" role="status" aria-label="확인 중" />
                  <span>{statusText}</span>
                </div>
              )}
            </div>

            {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}

            {ready && (
              <div className="sum-actions">
                <button className="btn btn-primary" onClick={confirm} disabled={busy}>
                  이 내용으로 요청하기
                </button>
                <button className="btn" onClick={leave}>
                  나중에
                </button>
              </div>
            )}

            {escalated && (
              <div className="callout" style={{ marginTop: 4 }}>
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                  <path d="M12 9v4M12 17h.01" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
                <div>
                  <span className="ct">확인이 필요해요</span> — 담당 매니저가 확인한 뒤 다시
                  알려드릴게요.
                </div>
              </div>
            )}

            {!ready && !escalated && (
              <p className="escape">
                기다리지 않아도 돼요 —{' '}
                <button onClick={leave}>닫아두면 준비됐을 때 알려드릴게요</button>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function formatRange(min: number, max: number): string {
  const m = (n: number) => `${Math.round(n / 10000)}만`
  return `${m(min)}~${m(max)}원`
}
