/**
 * 로그인 안내.
 *
 * 세션 없이 클라이언트 화면에 닿은 사람이 도착하는 곳이다. 여기서 들어갈 수는
 * 없다 — 문은 관리자가 발급한 초대 링크뿐이고, 이 화면은 그 사실만 알린다.
 *
 * 개발용 통로(`/dev-login`)는 여기서 안내하지 않는다. 화면마다 환경 이야기가
 * 따라붙는 걸 원하지 않아서다. 필요하면 주소로 바로 간다.
 */
export const dynamic = 'force-dynamic'

export default function LoginNotice() {
  return (
    <main className="wrap" style={{ maxWidth: 460 }}>
      <div className="page-head">
        <div>
          <h1>로그인이 필요해요</h1>
          <p className="sub">담당자가 보내드린 초대 링크로 들어와주세요</p>
        </div>
      </div>

      <div className="card">
        <p className="body">
          이 포털은 초대 링크와 PIN으로만 들어올 수 있어요. 링크를 못 받으셨거나
          링크가 더 이상 열리지 않는다면 담당자에게 재발급을 요청해주세요.
        </p>
      </div>
    </main>
  )
}
