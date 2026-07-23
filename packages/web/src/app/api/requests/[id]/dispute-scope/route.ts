/**
 * POST /api/requests/[id]/dispute-scope — "이건 계약에 포함된 건데요"
 *
 * 범위 판정의 목적이 분쟁을 막는 것인데 클라이언트가 반박할 통로가 없으면,
 * 우리는 분쟁을 막은 게 아니라 **일방 통보로 바꾼 것**이다. 그러면 분쟁은
 * 플랫폼 밖(전화·메일)으로 나가고 기록이 안 남는다.
 *
 * 새 status를 만들지 않는다. 횡단 플래그가 stage 위치를 보존한 채 얹히는 §7 원칙 그대로다.
 * `escalated`가 아니라 `on_hold`를 쓰는 이유 — escalated는 관리자 화면에
 * 에스컬레이션 답변 폼을 띄우고 그 경로가 접수 대화를 되살린다. 이의 제기에는 틀린 동작이다.
 */
import { NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { changeRequests, logEvent, messages, pendingNotices } from '@ticketree/shared'
import { db, getRequestById } from '@/lib/data'
import { requireClient, Unauthorized } from '@/lib/session'

const bodySchema = z.object({
  reason: z.string().trim().min(1, '어떤 점이 다른지 알려주세요').max(2000),
})

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let session
  try {
    session = await requireClient()
  } catch (e) {
    if (e instanceof Unauthorized) {
      return NextResponse.json({ error: '로그인이 필요해요' }, { status: 401 })
    }
    throw e
  }

  const { id } = await ctx.params
  const request = await getRequestById(session.projectId, id)
  if (!request) return NextResponse.json({ error: '요청을 찾을 수 없어요' }, { status: 404 })

  if (request.status !== 'quote_ready') {
    return NextResponse.json({ error: '지금은 견적을 검토하는 단계가 아니에요' }, { status: 409 })
  }
  if (request.flag === 'on_hold') {
    return NextResponse.json({ error: '이미 확인 중이에요' }, { status: 409 })
  }

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '입력을 확인해주세요' },
      { status: 400 },
    )
  }
  const { reason } = parsed.data

  const [last] = await db
    .select({ round: messages.round })
    .from(messages)
    .where(eq(messages.requestId, request.id))
    .orderBy(desc(messages.round))
    .limit(1)

  // 클라이언트가 쓴 말은 대화에 그대로 남는다 — 나중에 이 건이 어떻게 풀렸는지의 기록이다
  await db.insert(messages).values({
    requestId: request.id,
    round: (last?.round ?? 0) + 1,
    role: 'client',
    content: reason,
  })

  // status는 quote_ready 그대로. 공만 우리 쪽으로 넘어간다.
  await db
    .update(changeRequests)
    .set({
      flag: 'on_hold',
      flagFromStatus: request.status,
      yourTurn: false,
      updatedAt: new Date(),
    })
    .where(eq(changeRequests.id, request.id))

  await db.insert(pendingNotices).values({ requestId: request.id, type: 'scope_disputed' })
  await logEvent(db, request.id, { kind: 'client', id: session.userId }, {
    scopeDisputed: true,
    reason,
  })

  return NextResponse.json({ ok: true })
}
