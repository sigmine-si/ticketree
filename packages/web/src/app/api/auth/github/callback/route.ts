/**
 * GET /api/auth/github/callback — OAuth 콜백 (§16-1)
 *
 * 허용 목록에 없는 계정은 users 행을 만들지 않고 그대로 돌려보낸다.
 */
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { users } from '@ticketree/shared'
import { db } from '@/lib/data'
import { isAllowedAdmin, setSession } from '@/lib/session'

function deny(reason: string): NextResponse {
  const url = new URL('/admin/login', process.env.APP_ORIGIN ?? 'http://localhost:3000')
  url.searchParams.set('error', reason)
  return NextResponse.redirect(url)
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams
  const code = params.get('code')
  const state = params.get('state')

  const jar = await cookies()
  const expected = jar.get('tt_oauth_state')?.value
  jar.delete('tt_oauth_state')

  if (!code || !state || !expected || state !== expected) return deny('state')

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  })
  const token = (await tokenRes.json()) as { access_token?: string }
  if (!token.access_token) return deny('token')

  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: 'application/vnd.github+json',
    },
  })
  const gh = (await userRes.json()) as { id?: number; login?: string; name?: string }
  if (!gh.id || !gh.login) return deny('profile')

  if (!isAllowedAdmin(gh.login)) return deny('not_allowed')

  // 허용 목록을 통과한 계정만 여기 도달한다
  const [existing] = await db.select().from(users).where(eq(users.githubId, gh.id))
  const name = gh.name || gh.login

  let userId: string
  if (existing) {
    await db
      .update(users)
      .set({ githubLogin: gh.login, name, lastSeenAt: new Date() })
      .where(eq(users.id, existing.id))
    userId = existing.id
  } else {
    const [created] = await db
      .insert(users)
      .values({
        kind: 'admin',
        projectId: null,
        name,
        githubId: gh.id,
        githubLogin: gh.login,
        lastSeenAt: new Date(),
      })
      .returning({ id: users.id })
    userId = created!.id
  }

  await setSession({ userId, projectId: null, kind: 'admin', name })
  return NextResponse.redirect(
    new URL('/admin', process.env.APP_ORIGIN ?? 'http://localhost:3000'),
  )
}
