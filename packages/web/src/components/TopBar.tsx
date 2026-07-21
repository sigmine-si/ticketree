import Link from 'next/link'

export function TopBar({
  projectName,
  userName,
  active = 'requests',
}: {
  projectName: string
  userName: string
  active?: 'requests' | 'spec'
}) {
  return (
    <header className="topbar">
      <div className="topbar-in">
        <div className="brand">
          <span className="wordmark">
            ticket<span className="dot">.</span>tree
          </span>
          <span className="proj">{projectName}</span>
          <nav className="nav" aria-label="주 메뉴">
            <Link className={`nav-link${active === 'requests' ? ' on' : ''}`} href="/requests">
              요청
            </Link>
            <Link className={`nav-link${active === 'spec' ? ' on' : ''}`} href="/spec">
              명세
            </Link>
          </nav>
        </div>
        <div className="top-right">
          <div className="avatar">{userName.slice(0, 1)}</div>
        </div>
      </div>
    </header>
  )
}
