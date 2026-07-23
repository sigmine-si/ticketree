'use client'

/**
 * 문답 카드 하나 — 접수 대화와 과업내용서 대화가 공유한다.
 *
 * 원래 Thread.tsx와 NewRequestModal.tsx에 두 벌 있었고, 이미 갈라져 있었다.
 * "칩은 고르기만 하고 '답변 보내기'로 전송한다"가 Thread 쪽에만 반영돼,
 * 같은 대화가 모달에서 시작해 상세 화면에서 이어지는데 칩 동작이 달랐다.
 * 과업내용서가 세 번째 복사본을 만들기 전에 여기로 모은다.
 */
import { useState } from 'react'

export interface ThreadQuestion {
  id: string
  idx: number
  prompt: string
  hint: string | null
  options: string[]
  answerText: string | null
  answeredAt: string | null
}

export function QuestionBlock({
  q,
  onAnswer,
  /** false면 관리자 열람 — 무엇을 물었는지만 보이고 답하는 자리는 걷는다 */
  canAct = true,
  disabled = false,
}: {
  q: ThreadQuestion
  onAnswer: (q: ThreadQuestion, text: string, optionIdx: number | null) => Promise<void>
  canAct?: boolean
  disabled?: boolean
}) {
  const [text, setText] = useState('')
  // 칩은 고르기만 한다 — 실제 전송은 '답변 보내기'에서 일어난다. 그 전까지 자유롭게 바꾼다
  const [selected, setSelected] = useState<number | null>(null)

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
  const value = (selected !== null ? q.options[selected] : text.trim()) ?? ''
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
