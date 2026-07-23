import Link from 'next/link'
import { clientPath } from '@/lib/routes'

export function TopBar({
  projectName,
  userName,
  slug,
  /** false면 관리자가 클라이언트 화면을 열어본 것이다 (specs/overview.md 주소 규약) */
  canAct = true,
  active = 'requests',
}: {
  projectName: string
  userName: string
  slug: string
  canAct?: boolean
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
            <Link
              className={`nav-link${active === 'requests' ? ' on' : ''}`}
              href={clientPath.requests(slug)}
            >
              요청
            </Link>
            <Link
              className={`nav-link${active === 'spec' ? ' on' : ''}`}
              href={clientPath.spec(slug)}
            >
              명세
            </Link>
          </nav>
        </div>
        <div className="top-right">
          {/* 클라이언트 화면인 척하면 관리자가 왜 버튼이 없는지 모른다 */}
          {!canAct && <span className="viewing">관리자 열람 중 · 보기만 가능</span>}
          <div className="avatar">{userName.slice(0, 1)}</div>
        </div>
      </div>
    </header>
  )
}
