'use client'

/**
 * 요청 스레드 — spec.md §3
 *
 * 요청 원문, 시스템 메시지, 문답 카드, 견적 카드가 타임라인으로 쌓인다.
 * 진행 중일 때만 폴링한다 (§13 — 5~10초).
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { IntakeResult } from '@ticketree/shared/agent-io'

export interface ThreadQuestion {
  id: string
  idx: number
  prompt: string
  hint: string | null
  options: string[]
  answerText: string | null
  answeredAt: string | null
}
export interface ThreadMessage {
  id: string
  round: number
  role: 'client' | 'agent' | 'system'
  content: string
  payload: IntakeResult | null
  createdAt: string
  questions: ThreadQuestion[]
}

export function Thread({
  requestId,
  messages,
  clientName,
  projectName,
  busy,
  canAct = true,
  canConfirm,
  quote,
}: {
  requestId: string
  messages: ThreadMessage[]
  clientName: string
  projectName: string
  busy: boolean
  /**
   * false면 관리자 열람 — 답변·확정·견적 승인을 숨긴다 (specs/overview.md 주소 규약).
   * 자물쇠가 아니라 정직함이다. 실제 차단은 API의 requireClient가 한다.
   */
  canAct?: boolean
  canConfirm: boolean
  /** quote_ready일 때만 채워진다 — 확정 견적과 승인 버튼 (§7 이중 게이트의 첫 번째) */
  quote: { amount: number; days: string | null; scope: string[] } | null
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  // 진행 중일 때만 폴링한다 — 끝난 요청까지 계속 두드릴 이유가 없다
  useEffect(() => {
    if (!busy && !pending) return
    const t = setInterval(() => router.refresh(), 5000)
    return () => clearInterval(t)
  }, [busy, pending, router])

  async function answer(q: ThreadQuestion, text: string, optionIdx: number | null) {
    setPending(true)
    await fetch(`/api/requests/${requestId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: q.id, answer: text, optionIdx }),
    })
    router.refresh()
    setTimeout(() => setPending(false), 1000)
  }

  async function confirm() {
    setPending(true)
    await fetch(`/api/requests/${requestId}/confirm`, { method: 'POST' })
    router.refresh()
    setPending(false)
  }

  async function approveQuote() {
    setPending(true)
    await fetch(`/api/requests/${requestId}/approve-quote`, { method: 'POST' })
    router.refresh()
    setPending(false)
  }

  return (
    <div className="thread">
      {messages.map((m) =>
        m.role === 'client' ? (
          <div className="card" key={m.id}>
            <div className="card-head">
              <div className="mini-avatar">{clientName.slice(0, 1)}</div>
              <span className="who">{clientName}</span>
              <span className="when">{formatTime(m.createdAt)}</span>
            </div>
            <p className="body">{m.content}</p>
          </div>
        ) : (
          <AgentCard
            key={m.id}
            m={m}
            projectName={projectName}
            onAnswer={answer}
            canAct={canAct}
            disabled={pending || busy}
          />
        ),
      )}

      {busy && (
        <div className="status-line">
          <span className="spinner" role="status" aria-label="확인 중" />
          <span>요청 내용을 확정하기 위해 살펴보고 있어요 — 잠시 후 질문 또는 견적이 도착합니다</span>
        </div>
      )}

      {canConfirm && canAct && (
        <div className="card">
          <div className="est-actions" style={{ marginTop: 0 }}>
            <button className="btn btn-primary" onClick={confirm} disabled={pending}>
              이 내용으로 요청하기
            </button>
          </div>
        </div>
      )}

      {quote && (
        <div className="card est">
          <div className="est-head">
            <span className="t">확정 견적</span>
            <span className="note">승인하면 개발이 시작돼요</span>
          </div>
          <div className="figures">
            <div className="fig">
              <div className="k">확정 비용</div>
              <div className="v">₩{quote.amount.toLocaleString('ko-KR')}</div>
            </div>
            <div className="fig">
              <div className="k">예상 기간</div>
              <div className="v">{quote.days ?? '—'}</div>
            </div>
            <div className="fig">
              <div className="k">작업 범위</div>
              <div className="v">기능 {quote.scope.length}건</div>
            </div>
          </div>
          {quote.scope.length > 0 && (
            <div className="scope">
              <p className="sk">포함되는 작업</p>
              {quote.scope.map((s, i) => (
                <div className="scope-item" key={i}>
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  {s}
                </div>
              ))}
            </div>
          )}
          {/* 견적 자체는 관리자에게도 보인다. 누르는 것만 클라이언트의 몫이다 (§7 이중 게이트) */}
          {canAct && (
            <div className="est-actions">
              <button className="btn btn-primary" onClick={approveQuote} disabled={pending}>
                견적 승인하고 진행
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AgentCard({
  m,
  projectName,
  onAnswer,
  canAct,
  disabled,
}: {
  m: ThreadMessage
  projectName: string
  onAnswer: (q: ThreadQuestion, text: string, optionIdx: number | null) => Promise<void>
  canAct: boolean
  disabled: boolean
}) {
  const answered = m.questions.filter((q) => q.answeredAt).length
  const summary = m.payload?.outcome === 'ready' ? m.payload.summary : undefined

  return (
    <div className={`card${m.questions.length ? ' qcard' : ''}`}>
      <div className="qhead">
        <div className="mini-avatar" style={{ background: 'var(--page)', color: 'var(--sub)' }}>
          t.
        </div>
        <span className="who">{projectName} 담당</span>
        {m.questions.length > 0 && (
          <span className="qbadge">
            {answered}/{m.questions.length} 답변됨
          </span>
        )}
        {m.questions.length === 0 && <span className="when">{formatTime(m.createdAt)}</span>}
      </div>

      <p className="body" style={{ marginTop: 6 }}>
        {m.content}
      </p>

      {m.questions.map((q) => (
        <QuestionBlock key={q.id} q={q} onAnswer={onAnswer} canAct={canAct} disabled={disabled} />
      ))}

      {summary && (
        <div className="est" style={{ marginTop: 14 }}>
          <div className="figures">
            <div className="fig">
              <div className="k">예상 비용</div>
              <div className="v">{formatRange(summary.rough_min, summary.rough_max)}</div>
            </div>
            <div className="fig">
              <div className="k">예상 기간</div>
              <div className="v">{summary.estimated_days}</div>
            </div>
            <div className="fig">
              <div className="k">작업 범위</div>
              <div className="v">기능 {summary.scope.length}건</div>
            </div>
          </div>
          <div className="scope">
            <p className="sk">포함되는 작업</p>
            {summary.scope.map((s, i) => (
              <div className="scope-item" key={i}>
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                {s}
              </div>
            ))}
          </div>
        </div>
      )}

      {m.payload?.outcome === 'escalate' && (
        <div className="callout" style={{ marginTop: 12 }}>
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
    </div>
  )
}

function QuestionBlock({
  q,
  onAnswer,
  canAct,
  disabled,
}: {
  q: ThreadQuestion
  onAnswer: (q: ThreadQuestion, text: string, optionIdx: number | null) => Promise<void>
  canAct: boolean
  disabled: boolean
}) {
  const [text, setText] = useState('')
  // 칩은 고르기만 한다 — 실제 전송은 '답변 보내기'에서 일어난다. 그 전까지 자유롭게 바꾼다
  const [selected, setSelected] = useState<number | null>(null)

  // 관리자 열람 — 무엇을 물었는지는 보여주고, 답하는 자리만 걷는다
  if (!q.answeredAt && !canAct) {
    return (
      <div className="q">
        <p className="qt">
          {q.idx + 1}. {q.prompt}
        </p>
        <p className="qs">클라이언트 답변을 기다리는 중이에요</p>
      </div>
    )
  }

  if (q.answeredAt) {
    return (
      <div className="q">
        <p className="qt">
          {q.idx + 1}. {q.prompt}
        </p>
        <div className="answered">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          {q.answerText}
        </div>
      </div>
    )
  }

  // 고른 칩이 있으면 그 칩, 없으면 직접 입력한 글이 보낼 답이다
  const value = selected !== null ? q.options[selected] : text.trim()
  const canSend = !disabled && value.length > 0

  return (
    <div className="q">
      <p className="qt">
        {q.idx + 1}. {q.prompt}
      </p>
      <p className="qs">{q.hint ?? '보기에 없으면 아래에 직접 적어주세요'}</p>
      {q.options.length > 0 && (
        <div className="chips" style={{ marginBottom: 10 }}>
          {q.options.map((o, i) => (
            <button
              key={i}
              className={`chip${selected === i ? ' sel' : ''}`}
              disabled={disabled}
              onClick={() => {
                // 다시 누르면 선택 해제. 칩을 고르면 직접 입력은 비운다
                setSelected(selected === i ? null : i)
                setText('')
              }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
      <div className="answer-row">
        <input
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value)
            // 직접 입력을 시작하면 골라둔 칩은 놓는다
            if (selected !== null) setSelected(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSend) void onAnswer(q, value, selected)
          }}
          placeholder="직접 입력"
        />
        <button
          className="btn"
          disabled={!canSend}
          onClick={() => canSend && void onAnswer(q, value, selected)}
        >
          답변 보내기
        </button>
      </div>
    </div>
  )
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatRange(min: number, max: number): string {
  const m = (n: number) => `${Math.round(n / 10000)}만`
  return `${m(min)}~${m(max)}원`
}
