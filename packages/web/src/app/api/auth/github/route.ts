/**
 * GET /api/auth/github — GitHub OAuth 시작 (§16-1)
 *
 * state를 쿠키에 심고 authorize로 보낸다. 콜백에서 대조해 CSRF를 막는다.
 */
import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET() {
  const clientId = process.env.GITHUB_CLIENT_ID
  if (!clientId) {
    return NextResponse.json(
      { error: 'GITHUB_CLIENT_ID가 설정되지 않았어요' },
      { status: 500 },
    )
  }

  const state = randomBytes(16).toString('hex')
  ;(await cookies()).set('tt_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  })

  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('scope', 'read:user')
  url.searchParams.set('state', state)
  if (process.env.GITHUB_OAUTH_REDIRECT_URI) {
    url.searchParams.set('redirect_uri', process.env.GITHUB_OAUTH_REDIRECT_URI)
  }

  return NextResponse.redirect(url)
}
