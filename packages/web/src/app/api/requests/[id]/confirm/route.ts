/**
 * POST /api/requests/[id]/confirm — "이 내용으로 요청하기"
 *
 * §2: 클라이언트가 이 버튼을 누르는 순간 티켓이 정식 발행된다.
 * 그 전까지는 draft이고, 목록에는 확인 중인 항목으로만 보인다.
 */
import { NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { agentSessions, changeRequests, enqueueJob, messages, transition } from '@ticketree/shared'
import { db, getRequestById } from '@/lib/data'
import { requireClient, Unauthorized } from '@/lib/session'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
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

  const isSow = request.kind === 'sow'

  if (request.status !== 'draft') {
    return NextResponse.json(
      { error: isSow ? '이미 확정된 과업내용서예요' : '이미 확정된 요청이에요' },
      { status: 409 },
    )
  }

  // 확정 가능 상태인지 확인한다 — 마지막 에이전트 메시지가 ready여야 한다
  const [latest] = await db
    .select({ payload: messages.payload })
    .from(messages)
    .where(eq(messages.requestId, request.id))
    .orderBy(desc(messages.round))
    .limit(1)

  const payload = latest?.payload as { outcome?: string } | null
  if (payload?.outcome !== 'ready') {
    return NextResponse.json({ error: '아직 확정할 수 있는 상태가 아니에요' }, { status: 409 })
  }

  await db
    .update(changeRequests)
    .set({ confirmedAt: new Date() })
    .where(eq(changeRequests.id, request.id))

  await transition(db, request.id, 'submitted', { kind: 'client', id: session.userId }, {
    confirmed: true,
  })

  // 접수 대화 세션은 여기서 닫는다. 이후 단계는 탐색 노트와 변경 요청서만 물려받는다 (§4)
  await db
    .update(agentSessions)
    .set({ closedAt: new Date() })
    .where(eq(agentSessions.requestId, request.id))

  // 과업내용서는 견적을 타지 않는다 — 곧바로 명세 초안을 만든다.
  // 그 명세가 머지되면 계약이 발효되고, 거기서 과업내용서의 책임은 끝난다.
  await enqueueJob(db, {
    projectId: session.projectId,
    requestId: request.id,
    kind: isSow ? 'sow_spec_draft' : 'estimation',
  })

  return NextResponse.json({ ok: true, reqNo: request.reqNo })
}
