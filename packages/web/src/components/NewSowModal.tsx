'use client'

/**
 * 새 과업내용서 모달
 *
 * 접수 모달(NewRequestModal)과 대화 구조는 같다 — SSE로 진행을 받고, 문답 칩으로
 * 답하고, 확정 버튼으로 끝낸다. 폼이 다르다: 계약을 시작하는 자리라 "지금은 이래요"도
 * 긴급도도 없다. 무엇을 만들고 싶은지 하나만 받는다.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SowResult } from '@ticketree/shared/agent-io'
import { QuestionBlock, type ThreadQuestion } from './QuestionBlock'
import { SowCard } from './SowCard'

interface ThreadMessage {
  id: string
  role: 'client' | 'agent' | 'system'
  content: string
  payload: SowResult | null
  questions: ThreadQuestion[]
}

export function NewSowModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [phase, setPhase] = useState<'form' | 'chat'>('form')
  const [background, setBackground] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [sowId, setSowId] = useState<string | null>(null)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [thread, setThread] = useState<ThreadMessage[]>([])
  const chatRef = useRef<HTMLDivElement>(null)

  const latestAgent = [...thread].reverse().find((m) => m.role === 'agent')
  const ready = latestAgent?.payload?.outcome === 'ready'
  const escalated = latestAgent?.payload?.outcome === 'escalate'
  const remaining = latestAgent?.payload?.remaining ?? []

  // 모달이 열려 있는 동안 뒤 페이지 스크롤을 잠근다 — 채팅을 아래로 내릴 때
  // 스크롤이 뒤 페이지로 번져(scroll chaining) 페이지가 딸려 내려가던 것을 막는다
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // 새 내용이 오면 채팅을 아래로 붙인다. 단, 사용자가 위로 올려 읽는 중이면 당기지 않는다
  useEffect(() => {
    const el = chatRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) el.scrollTo({ top: el.scrollHeight })
  }, [thread, statusText])

  // 스트림은 요청과 공유한다 — job·메시지·status만 보므로 종류와 무관하다
  useEffect(() => {
    if (!sowId) return
    const es = new EventSource(`/api/requests/${sowId}/stream`)
    es.addEventListener('status', (e) => {
      setStatusText(JSON.parse((e as MessageEvent).data).text)
    })
    es.addEventListener('round', () => {
      setStatusText(null)
      void refreshThread(sowId)
    })
    es.addEventListener('idle', () => setStatusText(null))
    es.onerror = () => setStatusText(null)
    return () => es.close()
  }, [sowId])

  async function refreshThread(id: string) {
    const res = await fetch(`/api/requests/${id}/thread`)
    if (!res.ok) return
    const data = (await res.json()) as { messages: ThreadMessage[] }
    setThread(data.messages)
  }

  async function submit() {
    if (!background.trim()) {
      setError('무엇을 만들고 싶으신지 한 줄이라도 적어주세요')
      return
    }
    setBusy(true)
    setError(null)
    const res = await fetch('/api/sows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ background: background.trim() }),
    })
    setBusy(false)
    if (!res.ok) {
      setError(((await res.json()) as { error?: string }).error ?? '시작하지 못했어요')
      return
    }
    const { id } = (await res.json()) as { id: string }
    setSowId(id)
    setPhase('chat')
    setStatusText('내용을 정리하고 있어요')
    router.refresh()
  }

  async function answer(q: ThreadQuestion, text: string, optionIdx: number | null) {
    if (!sowId) return
    setStatusText('답변을 반영하고 있어요')
    await fetch(`/api/requests/${sowId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: q.id, answer: text, optionIdx }),
    })
    await refreshThread(sowId)
    router.refresh()
  }

  async function confirm() {
    if (!sowId) return
    setBusy(true)
    const res = await fetch(`/api/requests/${sowId}/confirm`, { method: 'POST' })
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
            <h3>새 과업내용서</h3>
            <p className="msub">
              무엇을 만들고 싶으신지 편하게 적어주세요 — 몇 가지 여쭤보고 과업내용서로 정리해드려요
            </p>

            <div className="mfield">
              <label htmlFor="bg">어떤 걸 만들고 싶으세요?</label>
              <textarea
                id="bg"
                value={background}
                onChange={(e) => setBackground(e.target.value)}
                rows={6}
                placeholder="예: 라이브 방송에서 파는 옷 주문을 자동으로 처리하는 쇼핑몰이 필요해요. 지금은 카톡으로 캡쳐를 받아서 사람이 일일이 금액을 매기고 입금을 확인하고 있어요."
              />
            </div>

            {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{error}</p>}

            <div className="mfoot">
              <span className="hint">
                범위·산출물·일정·검수 기준까지
                <br />
                함께 정리해드려요
              </span>
              <button className="btn" onClick={leave}>
                취소
              </button>
              <button className="btn btn-primary" onClick={submit} disabled={busy}>
                {busy ? '시작하는 중…' : '시작하기'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>과업내용서 정리</h3>
            <p className="msub">
              {remaining.length > 0
                ? `아직 정할 것 ${remaining.length}가지 — ${remaining.slice(0, 3).join(', ')}`
                : '몇 가지 여쭤보고 내용을 확정할게요'}
            </p>

            <div className="chat" ref={chatRef}>
              <div className="msg user">{background}</div>

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
                    {m.payload?.outcome === 'ready' && m.payload.sow && (
                      <SowCard sow={m.payload.sow} inline />
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
                  이 과업내용서로 확정하기
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
