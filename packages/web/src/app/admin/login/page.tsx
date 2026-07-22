/**
 * 관리자 로그인 — 아이디 + 비밀번호 (§16-1)
 *
 * 자격증명은 .env의 ADMIN_ID / ADMIN_PASSWORD 하나뿐이다.
 * 통과한 뒤에야 users 행을 만든다 — 틀린 시도는 아무 흔적도 남기지 않는다.
 */
import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { users } from '@ticketree/shared'
import { db } from '@/lib/data'
import { adminLoginConfigured, setSession, verifyAdminCredentials } from '@/lib/session'

const ERRORS: Record<string, string> = {
  invalid: '아이디 또는 비밀번호가 맞지 않아요.',
  unconfigured: '관리자 계정이 아직 설정되지 않았어요.',
}

export default async function AdminLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const configured = adminLoginConfigured()

  async function login(formData: FormData) {
    'use server'
    const id = String(formData.get('id') ?? '')
    const password = String(formData.get('password') ?? '')

    if (!adminLoginConfigured()) redirect('/admin/login?error=unconfigured')
    if (!verifyAdminCredentials(id, password)) redirect('/admin/login?error=invalid')

    // 자격증명을 통과한 계정만 여기 도달한다
    const name = process.env.ADMIN_ID!
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.kind, 'admin'), eq(users.name, name)))

    let userId: string
    if (existing) {
      await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, existing.id))
      userId = existing.id
    } else {
      const [created] = await db
        .insert(users)
        .values({ kind: 'admin', projectId: null, name, lastSeenAt: new Date() })
        .returning({ id: users.id })
      userId = created!.id
    }

    await setSession({ userId, projectId: null, kind: 'admin', name })
    redirect('/admin')
  }

  return (
    <main className="wrap" style={{ maxWidth: 420 }}>
      <div className="page-head">
        <div>
          <h1>관리자</h1>
          <p className="sub">아이디와 비밀번호로 로그인해요</p>
        </div>
      </div>

      {error && (
        <div className="callout" style={{ marginBottom: 14 }}>
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
            <path d="M12 9v4M12 17h.01" />
            <circle cx="12" cy="12" r="9" />
          </svg>
          <div>{ERRORS[error] ?? '로그인에 실패했어요.'}</div>
        </div>
      )}

      <div className="card">
        {configured ? (
          <form action={login}>
            <div className="mfield">
              <label htmlFor="admin-id">아이디</label>
              <input id="admin-id" name="id" type="text" autoComplete="username" autoFocus required />
            </div>

            <div className="mfield">
              <label htmlFor="admin-password">비밀번호</label>
              <input
                id="admin-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>

            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
              로그인
            </button>
          </form>
        ) : (
          <p style={{ fontSize: 13.5, color: 'var(--sub)', lineHeight: 1.7 }}>
            <strong>관리자 계정이 아직 설정되지 않았어요.</strong>
            <br />
            <code>ADMIN_ID</code>와 <code>ADMIN_PASSWORD</code>를 .env에 넣어주세요.
          </p>
        )}
      </div>
    </main>
  )
}
