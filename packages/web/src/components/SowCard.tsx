'use client'

/**
 * 과업내용서 카드 — 여덟 항목을 클라이언트가 읽는 순서로 그린다.
 *
 * 제외 범위만 앰버 콜아웃으로 갈라 그린다. 포함되는 것과 같은 초록 체크 목록에
 * 섞이면 "이것도 해준다"로 읽히는데, 계약에서 정확히 반대 뜻이기 때문이다.
 */
import type { SowDoc } from '@ticketree/shared/agent-io'

function List({ items }: { items: string[] }) {
  return (
    <div className="scope">
      {items.map((s, i) => (
        <div className="scope-item" key={i}>
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          {s}
        </div>
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 16 }}>
      <p className="sk">{title}</p>
      {children}
    </div>
  )
}

export function SowCard({
  sow,
  tag,
  /** 대화 카드 안에 얹을 때는 카드 테두리를 두 번 그리지 않는다 */
  inline = false,
}: {
  sow: SowDoc
  tag?: string
  inline?: boolean
}) {
  return (
    <div className={inline ? 'est' : 'card est'} style={inline ? { marginTop: 14 } : undefined}>
      <div className="est-head">
        <span className="t">{tag ? `${tag} 과업내용서` : '과업내용서'}</span>
        <span className="note">이 범위가 계약이 돼요</span>
      </div>

      <div className="figures">
        <div className="fig">
          <div className="k">과업 범위</div>
          <div className="v">{sow.scope.length}건</div>
        </div>
        <div className="fig">
          <div className="k">산출물</div>
          <div className="v">{sow.deliverables.length}건</div>
        </div>
        <div className="fig">
          <div className="k">마일스톤</div>
          <div className="v">{sow.milestones.length}개</div>
        </div>
      </div>

      <Section title="과업 개요">
        <p className="body" style={{ whiteSpace: 'pre-wrap' }}>
          {sow.overview}
        </p>
      </Section>

      <Section title="이번 계약으로 만드는 것">
        <List items={sow.scope} />
      </Section>

      {/* 계약에서 가장 중요한 항목이다 — 나중에 "이것도 해주는 줄 알았다"가 여기서 갈린다 */}
      <div className="callout" style={{ marginTop: 16 }}>
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
          <path d="M12 9v4M12 17h.01" />
          <circle cx="12" cy="12" r="9" />
        </svg>
        <div>
          <span className="ct">이번 계약에 포함되지 않는 것</span>
          <div style={{ marginTop: 6 }}>
            {sow.out_of_scope.map((s, i) => (
              <div key={i}>· {s}</div>
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--sub)' }}>
            나중에 필요해지면 따로 요청하실 수 있어요 — 그때는 별도 견적으로 안내드려요.
          </div>
        </div>
      </div>

      <Section title="요구사항">
        <List items={sow.requirements} />
      </Section>

      <Section title="산출물">
        <List items={sow.deliverables} />
      </Section>

      <Section title="일정">
        <div className="scope">
          {sow.milestones.map((m, i) => (
            <div className="scope-item" key={i}>
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              {m.name}
              <span className="ftag" style={{ marginLeft: 6 }}>
                {m.due}
              </span>
            </div>
          ))}
        </div>
      </Section>

      {sow.provided.length > 0 && (
        <Section title="준비해주셔야 할 것">
          <List items={sow.provided} />
        </Section>
      )}

      <Section title="검수 기준">
        <List items={sow.acceptance} />
      </Section>
    </div>
  )
}
