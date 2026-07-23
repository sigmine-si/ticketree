/**
 * POST /api/admin/users/[id]/invite — 초대 링크와 PIN을 발급한다
 *
 * 평문 토큰·PIN은 이 응답 본문에만 실린다. 주소나 리다이렉트에 싣지 않는다 —
 * 그러면 브라우저 기록과 서버 로그에 남는다.
 *
 * 재발급은 이전 링크·PIN을 함께 무효화하고, 5회 실패로 걸린 잠금도 푼다
 * (specs/features/client-login.md).
 */
import { NextResponse } from 'next/server'
import { issueInvite } from '@/lib/admin'
import { requireAdmin, Unauthorized } from '@/lib/session'
import { clientPath } from '@/lib/routes'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
  } catch (e) {
    if (e instanceof Unauthorized) {
      return NextResponse.json({ error: '권한이 없어요' }, { status: 401 })
    }
    throw e
  }

  const { id } = await ctx.params
  const issued = await issueInvite(id)
  if (!issued) return NextResponse.json({ error: '고객 계정을 찾을 수 없어요' }, { status: 404 })

  return NextResponse.json({
    name: issued.name,
    pin: issued.pin,
    // 관리자가 그대로 복사해 보낼 수 있어야 하므로 전체 주소로 만든다
    url: new URL(clientPath.invite(issued.token), req.url).toString(),
  })
}
