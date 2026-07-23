'use client'

/**
 * 알림 뱃지 — spec.md §11 (수동 알림)
 *
 * 자동 발송 채널은 만들지 않는다(specs/product.md의 "안 만드는 것").
 * 대신 쌓인 일을 화면에서 놓치지 않게 한다 — 지금까지 pending_notices 는
 * 쌓기만 하고 읽는 곳이 없어서, 관리자가 큐를 직접 새로고침해야 알았다.
 */
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

export interface NoticeItem {
  id: string
  type: string
  label: string
  createdAt: string
  reqNo: number | null
  title: string | null
  projectSlug: string
  projectName: string
}

export function NoticeBell({ items }: { items: NoticeItem[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // 바깥을 누르면 닫는다 — 뱃지는 화면을 가리는 물건이 아니다
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  async function dismiss(ids: string[]) {
    if (ids.length === 0) return
    setBusy(true)
    await fetch('/api/admin/notices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="bell-wrap" ref={box}>
      <button
        className="bell"
        onClick={() => setOpen(!open)}
        aria-label={`알림 ${items.length}건`}
      >
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8">
          <path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
          <path d="M13.7 21a2 2 0 01-3.4 0" />
        </svg>
        {items.length > 0 && <span className="bell-count">{items.length}</span>}
      </button>

      {open && (
        <div className="bell-panel">
          <div className="bell-head">
            <span>알림 {items.length}건</span>
            {items.length > 0 && (
              <button
                className="bell-clear"
                disabled={busy}
                onClick={() => void dismiss(items.map((i) => i.id))}
              >
                모두 읽음
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="bell-empty">새 알림이 없어요</p>
          ) : (
            items.map((n) => (
              <Link
                key={n.id}
                href={`/admin/${n.projectSlug}`}
                className="bell-item"
                onClick={() => void dismiss([n.id])}
              >
                <span className={`bell-dot ${toneOf(n.type)}`} />
                <span className="bell-body">
                  <span className="bell-label">{n.label}</span>
                  <span className="bell-meta">
                    {n.projectName}
                    {n.reqNo !== null && ` · REQ-${String(n.reqNo).padStart(3, '0')}`}
                    {n.title && ` ${n.title}`}
                  </span>
                </span>
                <span className="bell-when">{ago(n.createdAt)}</span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/** 색은 급한 정도를 뜻한다 — 사람이 움직여야 하는 것이 붉다. */
function toneOf(type: string): string {
  if (type === 'escalated' || type === 'job_failed') return 'red'
  if (type === 'quote_ready' || type === 'manual_deploy_required') return 'amber'
  return 'green'
}

function ago(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return '방금'
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  return `${Math.floor(h / 24)}일 전`
}
