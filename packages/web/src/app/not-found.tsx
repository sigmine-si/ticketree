/**
 * 404 — 앱 라우터용.
 *
 * 이 파일이 없으면 빌드가 pages 라우터의 _error로 404·500을 프리렌더하려다
 * "<Html> should not be imported outside of pages/_document"로 죽는다.
 */
import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="wrap" style={{ maxWidth: 520 }}>
      <div className="page-head">
        <div>
          <h1>찾을 수 없어요</h1>
          <p className="sub">주소가 바뀌었거나, 접근할 수 없는 요청일 수 있어요</p>
        </div>
      </div>
      <div className="card">
        {/* 여기서는 어느 프로젝트인지 알 수 없다 — 루트가 세션을 보고 갈라준다 */}
        <Link className="btn" href="/">
          요청 목록으로
        </Link>
      </div>
    </main>
  )
}
