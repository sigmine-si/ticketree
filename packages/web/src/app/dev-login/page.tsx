/**
 * 개발용 로그인 — 슬라이스 1 한정.
 *
 * 실제 클라이언트 로그인은 초대링크 + PIN이다 (§10). 그 화면은 슬라이스 2에서 만든다.
 * 세션 레이어는 이미 진짜이므로, 여기서 세션을 발급하면 나머지는 그대로 동작한다.
 */
import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { projects, users } from '@ticketree/shared'
import { db } from '@/lib/data'
import { setSession } from '@/lib/session'
import { clientPath } from '@/lib/routes'

export default async function DevLogin() {
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

  async function login(formData: FormData) {
    'use server'
    const userId = String(formData.get('userId'))
    const [u] = await db
      .select({
        id: users.id,
        name: users.name,
        projectId: users.projectId,
        slug: projects.slug,
      })
      .from(users)
      .innerJoin(projects, eq(users.projectId, projects.id))
      .where(and(eq(users.id, userId), eq(users.kind, 'client')))
    if (!u?.projectId) return
    await setSession({ userId: u.id, projectId: u.projectId, kind: 'client', name: u.name })
    redirect(clientPath.requests(u.slug))
  }

  return (
    <main className="wrap" style={{ maxWidth: 520 }}>
      <div className="page-head">
        <div>
          <h1>개발용 로그인</h1>
          <p className="sub">
            슬라이스 1 임시 화면이에요 — 실제 로그인은 초대링크 + PIN입니다
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
            <form key={r.userId} action={login} style={{ marginBottom: 8 }}>
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
