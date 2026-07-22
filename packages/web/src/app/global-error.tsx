'use client'

/**
 * 앱 라우터 최상단 오류 화면.
 *
 * not-found와 함께 이 파일이 있어야 빌드가 pages 라우터의 _error를 끌어오지 않는다.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="ko">
      <body>
        <main className="wrap" style={{ maxWidth: 520 }}>
          <div className="page-head">
            <div>
              <h1>문제가 생겼어요</h1>
              <p className="sub">잠시 후 다시 시도해주세요</p>
            </div>
          </div>
          <div className="card">
            <button className="btn" onClick={reset}>
              다시 시도
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
