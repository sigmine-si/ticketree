import Link from 'next/link'

export function AdminTopBar({
  userName,
  running,
  queued,
}: {
  userName: string
  running: number
  queued: number
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
            <Link className="nav-link on" href="/admin">
              검토 큐
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
