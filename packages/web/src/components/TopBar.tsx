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
            {/* 명세 화면은 슬라이스 3 */}
            <span className="nav-link" style={{ opacity: 0.4, cursor: 'default' }}>
              명세
            </span>
          </nav>
        </div>
        <div className="top-right">
          <div className="avatar">{userName.slice(0, 1)}</div>
        </div>
      </div>
    </header>
  )
}
