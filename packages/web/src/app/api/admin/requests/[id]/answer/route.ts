/**
 * POST /api/admin/requests/[id]/answer — 에스컬레이션에 답한다
 *
 * §5: 에이전트가 Spec 충돌·모호함을 발견해 멈춘 건은 사람이 해석해줘야 풀린다.
 * 관리자의 답변을 대화에 넣고 플래그를 걷은 뒤 에이전트를 다시 깨운다.
 */
import { NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { changeRequests, enqueueJob, logEvent, messages } from '@ticketree/shared'
import { db } from '@/lib/data'
import { requireAdmin, Unauthorized } from '@/lib/session'

const bodySchema = z.object({
  answer: z.string().trim().min(1, '답변을 입력해주세요').max(4000),
})

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let admin
  try {
    admin = await requireAdmin()
  } catch (e) {
    if (e instanceof Unauthorized) return NextResponse.json({ error: '권한이 없어요' }, { status: 401 })
    throw e
  }

  const { id } = await ctx.params
  const [request] = await db.select().from(changeRequests).where(eq(changeRequests.id, id))
  if (!request) return NextResponse.json({ error: '요청을 찾을 수 없어요' }, { status: 404 })
  if (request.flag !== 'escalated') {
    return NextResponse.json({ error: '에스컬레이션 상태가 아니에요' }, { status: 409 })
  }

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '입력을 확인해주세요' },
      { status: 400 },
    )
  }

  const [last] = await db
    .select({ round: messages.round })
    .from(messages)
    .where(eq(messages.requestId, request.id))
    .orderBy(desc(messages.round))
    .limit(1)

  // system 역할로 넣는다 — 클라이언트가 쓴 말이 아니고, 에이전트에게는 내부 지침이다
  await db.insert(messages).values({
    requestId: request.id,
    round: (last?.round ?? 0) + 1,
    role: 'system',
    content: `[운영자 해석] ${parsed.data.answer}`,
  })

  // 어느 단계에서 멈췄는지에 따라 재개할 job이 다르다.
  // 구현 중 막힌 것이면 구현을 다시 돌리고, 접수 단계면 대화 라운드를 재개한다.
  const resumeKind = request.flagFromStatus === 'developing' ? 'implementation' : 'intake_round'

  await db
    .update(changeRequests)
    .set({ flag: null, flagFromStatus: null, updatedAt: new Date() })
    .where(eq(changeRequests.id, request.id))

  await logEvent(db, request.id, { kind: 'admin', id: admin.userId }, {
    escalationAnswered: true,
    resumeKind,
  })

  await enqueueJob(db, {
    projectId: request.projectId,
    requestId: request.id,
    kind: resumeKind,
  })

  return NextResponse.json({ ok: true })
}
