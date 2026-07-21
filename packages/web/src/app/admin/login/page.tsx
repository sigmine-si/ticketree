import { redirect } from 'next/navigation'
import { users } from '@ticketree/shared'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/data'
import { setSession } from '@/lib/session'

const ERRORS: Record<string, string> = {
  state: '로그인 요청이 만료됐어요. 다시 시도해주세요.',
  token: 'GitHub 인증에 실패했어요.',
  profile: 'GitHub 계정 정보를 가져오지 못했어요.',
  not_allowed: '이 계정은 관리자 목록에 없어요.',
}

export default async function AdminLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const configured = Boolean(process.env.GITHUB_CLIENT_ID)
  const isDev = process.env.NODE_ENV !== 'production'

  // 개발 편의용 우회. 프로덕션 빌드에서는 렌더되지 않는다.
  async function devLogin() {
    'use server'
    if (process.env.NODE_ENV === 'production') return
    const [existing] = await db.select().from(users).where(eq(users.kind, 'admin'))
    const id =
      existing?.id ??
      (
        await db
          .insert(users)
          .values({ kind: 'admin', projectId: null, name: '개발 관리자' })
          .returning({ id: users.id })
      )[0]!.id
    await setSession({ userId: id, projectId: null, kind: 'admin', name: existing?.name ?? '개발 관리자' })
    redirect('/admin')
  }

  return (
    <main className="wrap" style={{ maxWidth: 420 }}>
      <div className="page-head">
        <div>
          <h1>관리자</h1>
          <p className="sub">GitHub 계정으로 로그인해요</p>
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
          <a className="btn btn-primary" href="/api/auth/github" style={{ width: '100%', justifyContent: 'center' }}>
            GitHub으로 로그인
          </a>
        ) : (
          <p style={{ fontSize: 13.5, color: 'var(--sub)', lineHeight: 1.7 }}>
            <strong>GitHub OAuth가 아직 설정되지 않았어요.</strong>
            <br />
            GitHub에서 OAuth App을 만들고 <code>GITHUB_CLIENT_ID</code>,{' '}
            <code>GITHUB_CLIENT_SECRET</code>, <code>ADMIN_GITHUB_LOGINS</code>를 .env에
            넣어주세요.
          </p>
        )}

        {isDev && (
          <form action={devLogin} style={{ marginTop: 14 }}>
            <button className="btn" style={{ width: '100%' }}>
              개발용 관리자로 들어가기
            </button>
            <p style={{ fontSize: 12, color: 'var(--faint)', marginTop: 8, textAlign: 'center' }}>
              로컬 개발에서만 보여요
            </p>
          </form>
        )}
      </div>
    </main>
  )
}
