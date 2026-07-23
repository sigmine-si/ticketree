'use client'

/**
 * 요청 스레드 — spec.md §3
 *
 * 요청 원문, 시스템 메시지, 문답 카드, 견적 카드가 타임라인으로 쌓인다.
 * 진행 중일 때만 폴링한다 (§13 — 5~10초).
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type {
  IntakeResult,
  ScopeBasis,
  ScopeVerdict,
  SowResult,
} from '@ticketree/shared/agent-io'
import type { RequestKind } from '@ticketree/shared/kind'
import { QuestionBlock, type ThreadQuestion } from './QuestionBlock'
import { SowCard } from './SowCard'

export type { ThreadQuestion }

/**
 * 접수 대화와 과업내용서 대화가 같은 스레드 구조를 쓴다 — 담기는 결과만 다르다.
 * 어느 쪽인지는 필드 존재로 가른다(아래 summaryOf·sowOf).
 */
export type ThreadPayload = IntakeResult | SowResult

export interface ThreadMessage {
  id: string
  round: number
  role: 'client' | 'agent' | 'system'
  content: string
  payload: ThreadPayload | null
  createdAt: string
  questions: ThreadQuestion[]
}

const summaryOf = (p: ThreadPayload | null) =>
  p && p.outcome === 'ready' && 'summary' in p ? p.summary : undefined
const sowOf = (p: ThreadPayload | null) =>
  p && p.outcome === 'ready' && 'sow' in p ? p.sow : undefined

export function Thread({
  requestId,
  messages,
  clientName,
  projectName,
  busy,
  canAct = true,
  canConfirm,
  quote,
  kind = 'change',
}: {
  requestId: string
  messages: ThreadMessage[]
  clientName: string
  projectName: string
  busy: boolean
  /** 과업내용서면 견적·승인 자리가 없고 확정 문구가 달라진다 */
  kind?: RequestKind
  /**
   * false면 관리자 열람 — 답변·확정·견적 승인을 숨긴다 (주소 규약).
   * 자물쇠가 아니라 정직함이다. 실제 차단은 API의 requireClient가 한다.
   */
  canAct?: boolean
  canConfirm: boolean
  /** quote_ready일 때만 채워진다 — 확정 견적과 승인 버튼 (§7 이중 게이트의 첫 번째) */
  quote: {
    amount: number
    days: string | null
    scope: string[]
    /** 과업내용서 범위 판정. 계약이 없는 프로젝트는 null이고 화면이 이전 그대로다. */
    verdict: ScopeVerdict | null
    clientNote: string | null
    coveredAmount: number | null
    basis: ScopeBasis[]
    coveredTasks: string[]
    billableTasks: string[]
  } | null
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
          <span>
            {kind === 'sow'
              ? '과업내용서를 정리하고 있어요 — 잠시 후 질문이 도착합니다'
              : '요청 내용을 확정하기 위해 살펴보고 있어요 — 잠시 후 질문 또는 견적이 도착합니다'}
          </span>
        </div>
      )}

      {canConfirm && canAct && (
        <div className="card">
          {kind === 'sow' && (
            <p className="cs" style={{ marginBottom: 10 }}>
              확정하면 이 내용이 계약 범위가 되고, 서비스 명세로 정리돼요.
            </p>
          )}
          <div className="est-actions" style={{ marginTop: 0 }}>
            <button className="btn btn-primary" onClick={confirm} disabled={pending}>
              {kind === 'sow' ? '이 과업내용서로 확정하기' : '이 내용으로 요청하기'}
            </button>
          </div>
        </div>
      )}

      {quote && (
        <div className="card est">
          <div className="est-head">
            <span className="t">
              {quote.verdict === 'included' ? '추가 비용 없이 진행돼요' : '확정 견적'}
            </span>
            <span className="note">
              {quote.verdict === 'included'
                ? '승인하면 개발이 시작돼요'
                : quote.verdict === 'partial'
                  ? '계약에 없던 부분만 비용이 들어요'
                  : '승인하면 개발이 시작돼요'}
            </span>
          </div>

          {quote.clientNote && (
            <p className="cs" style={{ marginBottom: 12 }}>
              {quote.clientNote}
            </p>
          )}

          <div className="figures">
            <div className="fig">
              <div className="k">{quote.verdict === 'partial' ? '추가 비용' : '확정 비용'}</div>
              <div className="v">
                {quote.verdict === 'included'
                  ? '추가 비용 없음'
                  : `₩${quote.amount.toLocaleString('ko-KR')}`}
              </div>
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

          {/* 일부만 포함일 때는 두 블록으로 갈라 그린다 — 섞으면 무엇이 유료인지 안 보인다 */}
          {quote.verdict === 'partial' ? (
            <>
              {quote.coveredTasks.length > 0 && (
                <div className="scope">
                  <p className="sk">계약에 포함된 부분 — 추가 비용 없음</p>
                  {quote.coveredTasks.map((s, i) => (
                    <div className="scope-item" key={i}>
                      <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      {s}
                    </div>
                  ))}
                </div>
              )}
              {quote.billableTasks.length > 0 && (
                <div className="scope" style={{ marginTop: 12 }}>
                  <p className="sk">계약에 없던 새 작업 — 별도 비용</p>
                  {quote.billableTasks.map((s, i) => (
                    <div className="scope-item" key={i}>
                      <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      {s}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            quote.scope.length > 0 && (
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
            )
          )}

          {quote.basis.length > 0 && <ScopeBasisBlock basis={quote.basis} />}

          {/* 견적 자체는 관리자에게도 보인다. 누르는 것만 클라이언트의 몫이다 (§7 이중 게이트) */}
          {canAct && (
            <div className="est-actions">
              <button className="btn btn-primary" onClick={approveQuote} disabled={pending}>
                {quote.verdict === 'included' ? '이 내용으로 진행하기' : '견적 승인하고 진행'}
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
  const summary = summaryOf(m.payload)
  const sow = sowOf(m.payload)

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

      {sow && <SowCard sow={sow} inline />}

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

/**
 * 판정 근거 — 과업내용서 원문을 그대로 보여준다.
 *
 * 문장을 조립하지 않고 원문을 찍는다. 이 기능이 분쟁을 막는 방식이
 * "우리가 이렇게 판단했습니다"가 아니라 "계약서에 이렇게 적혀 있습니다"이기 때문이다.
 *
 * 제외 범위에 걸린 근거는 접지 않고 펼쳐둔다 — 계약할 때 명시적으로 뺀 항목이라는
 * 사실이 클라이언트가 알아야 할 것 중 가장 중요하다.
 */
function ScopeBasisBlock({ basis }: { basis: ScopeBasis[] }) {
  const hasExcluded = basis.some((b) => b.reason === 'excluded')
  const [open, setOpen] = useState(hasExcluded)

  return (
    <div style={{ marginTop: 14 }}>
      <button
        className="btn"
        style={{ fontSize: 13, padding: '6px 12px' }}
        onClick={() => setOpen(!open)}
      >
        {open ? '근거 접기' : '어디에 그렇게 적혀 있나요?'}
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          {basis.map((b, i) => (
            <div
              key={i}
              style={{
                borderLeft: '3px solid var(--line)',
                paddingLeft: 12,
                marginBottom: 12,
              }}
            >
              <p className="qs" style={{ marginBottom: 4 }}>
                {b.sow}
                {b.clause && ` · ${b.clause}`}
                {b.reason === 'excluded' && (
                  <span className="ftag" style={{ marginLeft: 6 }}>
                    제외 범위
                  </span>
                )}
              </p>
              <p className="body" style={{ margin: 0 }}>
                {b.quote}
              </p>
            </div>
          ))}
        </div>
      )}
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
