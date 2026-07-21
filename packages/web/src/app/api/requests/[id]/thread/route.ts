/** GET /api/requests/[id]/thread — 접수 대화 모달이 라운드 결과를 가져간다. */
import { NextResponse } from 'next/server'
import { db, getRequestById, getThread } from '@/lib/data'
import { requireClient, Unauthorized } from '@/lib/session'
import { changeRequests } from '@ticketree/shared'
import { eq } from 'drizzle-orm'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  let session
  try {
    session = await requireClient()
  } catch (e) {
    if (e instanceof Unauthorized) return NextResponse.json({ error: '로그인이 필요해요' }, { status: 401 })
    throw e
  }

  const { id } = await ctx.params
  const request = await getRequestById(session.projectId, id)
  if (!request) return NextResponse.json({ error: '요청을 찾을 수 없어요' }, { status: 404 })

  const [state] = await db
    .select({ status: changeRequests.status, flag: changeRequests.flag })
    .from(changeRequests)
    .where(eq(changeRequests.id, request.id))

  return NextResponse.json({ messages: await getThread(request.id), ...state })
}
