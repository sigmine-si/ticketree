/**
 * POST /api/requests/[id]/approve-quote — 클라이언트의 견적 승인
 *
 * §7 이중 게이트의 첫 번째. "이 내용과 가격에 동의"까지가 클라이언트의 판단이고,
 * "기술적으로 타당하고 에이전트를 풀어도 안전한가"는 관리자가 따로 본다.
 * 승인 후 구간은 클라이언트에게 "개발 중"으로 보인다.
 */
import { NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { estimates, transition } from '@ticketree/shared'
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

  if (request.status !== 'quote_ready') {
    return NextResponse.json({ error: '승인할 수 있는 상태가 아니에요' }, { status: 409 })
  }
  // 범위 판정에 이의를 낸 동안에는 승인이 잠긴다 — 이견을 낸 금액이 그대로 확정되면 안 된다
  if (request.flag === 'on_hold') {
    return NextResponse.json(
      { error: '알려주신 내용을 확인하는 중이에요 — 답변 후에 진행할 수 있어요' },
      { status: 409 },
    )
  }

  const [estimate] = await db
    .select()
    .from(estimates)
    .where(eq(estimates.requestId, request.id))
    .orderBy(desc(estimates.version))
    .limit(1)
  if (!estimate) return NextResponse.json({ error: '견적이 없어요' }, { status: 409 })

  await db
    .update(estimates)
    .set({ clientApprovedAt: new Date() })
    .where(eq(estimates.id, estimate.id))

  await transition(db, request.id, 'client_approved', { kind: 'client', id: session.userId }, {
    approvedAmount: estimate.finalAmount ?? estimate.proposedAmount,
  })

  return NextResponse.json({ ok: true })
}
