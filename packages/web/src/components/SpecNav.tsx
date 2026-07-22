'use client'

/**
 * 명세 목록과 검색 — spec.md §3
 *
 * 기능이 스무 장쯤 되면 "환불 얘기가 어디 있더라"를 찾을 방법이 필요하다.
 * 제목만이 아니라 항목 본문까지 훑는다 — 클라이언트는 기능 이름이 아니라
 * 자기가 겪은 상황("환불", "쿠폰")으로 찾는다.
 */
import Link from 'next/link'
import { useMemo, useState } from 'react'

export interface SpecNavItem {
  slug: string
  title: string
  layer: 'product' | 'overview' | 'feature'
  pending: number
  /** 제목 + 항목 + 제약 — 검색 대상 본문 */
  haystack: string
}

export function SpecNav({ items, current }: { items: SpecNavItem[]; current: string | null }) {
  const [q, setQ] = useState('')

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return items
    return items.filter((i) => i.haystack.toLowerCase().includes(needle))
  }, [items, q])

  return (
    <aside className="spec-side">
      <p className="sh">기능</p>

      <input
        className="spec-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="찾고 싶은 내용을 적어보세요"
        aria-label="명세 검색"
      />

      {shown.length === 0 ? (
        <p className="spec-empty">‘{q}’에 해당하는 내용이 없어요</p>
      ) : (
        shown.map((s, i) => (
          <div key={s.slug}>
            {/* 제품·흐름과 기능 사이에만 선을 긋는다 — 층이 다르다는 걸 보이게 */}
            {s.layer === 'feature' && shown[i - 1] && shown[i - 1]!.layer !== 'feature' && (
              <p className="sh spec-divider">기능</p>
            )}
            <Link
              href={`/spec?f=${s.slug}`}
              className={`spec-item${s.slug === current ? ' on' : ''}`}
            >
              {s.title}
              {s.pending > 0 && <span className="flag" title="변경 예정" />}
            </Link>
          </div>
        ))
      )}
    </aside>
  )
}
