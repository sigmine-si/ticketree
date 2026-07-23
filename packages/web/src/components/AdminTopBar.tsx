import Link from 'next/link'
import { adminPath } from '@/lib/routes'

export function AdminTopBar({
  userName,
  running,
  queued,
  current = 'queue',
}: {
  userName: string
  running: number
  queued: number
  /** 지금 보고 있는 메뉴 — 하이라이트만 정한다 */
  current?: 'queue' | 'invites'
}) {
  return (
    <header className="topbar admin">
      <div className="topbar-in">
        <div className="brand">
          <span className="wordmark">
            ticket<span className="dot">.</span>tree
          </span>
          <span className="admin-tag">ADMIN</span>
          <nav className="nav" aria-label="주 메뉴">
            <Link
              className={current === 'queue' ? 'nav-link on' : 'nav-link'}
              href={adminPath.queue}
            >
              검토 큐
            </Link>
            <Link
              className={current === 'invites' ? 'nav-link on' : 'nav-link'}
              href={adminPath.invites}
            >
              고객 계정
            </Link>
          </nav>
        </div>
        <div className="top-right">
          <div className="runner-chip">
            {running > 0 && <span className="pulse" />}
            runner {running}/1 · queue {queued}
          </div>
          <div className="avatar">{userName.slice(0, 1)}</div>
        </div>
      </div>
    </header>
  )
}
