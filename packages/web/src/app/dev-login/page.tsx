/**
 * 개발용 로그인 — **로컬 전용 통로**.
 *
 * 실제 클라이언트 로그인은 초대 링크 + PIN이다 (`/invite/[token]`).
 * 이 화면은 로컬에서 로그인 흐름 없이 DB에 들어가는 유일한 문이라 남겨두되,
 * 실제 서비스에서는 통째로 닫는다 — 열어두면 누구나 아무 고객으로 로그인된다.
 */
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { projects, users } from '@ticketree/shared'
import { db } from '@/lib/data'
import { devLoginEnabled } from '@/lib/session'
import { devLogin } from './actions'

export default async function DevLogin() {
  // 있다는 사실조차 알리지 않는다. 프로덕션에는 이 주소가 없는 것과 같다.
  if (!devLoginEnabled()) notFound()

  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      projectId: projects.id,
      projectName: projects.name,
      slug: projects.slug,
    })
    .from(users)
    .innerJoin(projects, eq(users.projectId, projects.id))
    .where(eq(users.kind, 'client'))

  return (
    <main className="wrap" style={{ maxWidth: 520 }}>
      <div className="page-head">
        <div>
          <h1>개발용 로그인</h1>
          <p className="sub">
            로컬 전용 통로예요 — 실제 로그인은 초대 링크 + PIN입니다
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <p className="body">
            클라이언트 계정이 없습니다. <code>pnpm seed</code>를 먼저 실행하세요.
          </p>
        </div>
      ) : (
        <div className="card">
          {rows.map((r) => (
            <form key={r.userId} action={devLogin} style={{ marginBottom: 8 }}>
              <input type="hidden" name="userId" value={r.userId} />
              <button className="btn" style={{ width: '100%', textAlign: 'left' }}>
                <strong>{r.name}</strong>
                <span style={{ color: 'var(--faint)', marginLeft: 8, fontSize: 12.5 }}>
                  {r.projectName}
                </span>
              </button>
            </form>
          ))}
        </div>
      )}
    </main>
  )
}
