/**
 * POST /api/admin/requests/[id]/decide — 관리자 결정
 *
 * §7 이중 게이트의 두 번째. 클라이언트는 "이 내용과 가격에 동의"를 판단했고,
 * 관리자는 "기술적으로 타당하고 에이전트를 풀어도 안전한가"를 판단한다.
 *
 * 비가역적 동작(머지·배포)은 반드시 이 승인 뒤에 러너가 실행한다 (§1).
 */
import { NextResponse } from 'next/server'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  changeRequests,
  enqueueJob,
  estimates,
  logEvent,
  pullRequests,
  transition,
} from '@ticketree/shared'
import { db } from '@/lib/data'
import { requireAdmin, Unauthorized } from '@/lib/session'

const bodySchema = z.object({
  action: z.enum(['approve_spec', 'request_changes', 'reject']),
  /** 관리자가 조정한 청구 금액 (원) */
  finalAmount: z.number().int().nonnegative().optional(),
  comment: z.string().trim().max(2000).optional(),
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

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: '입력을 확인해주세요' }, { status: 400 })
  }
  const { action, finalAmount, comment } = parsed.data

  if (request.status !== 'client_approved') {
    return NextResponse.json(
      { error: '지금은 Spec 승인 단계가 아니에요' },
      { status: 409 },
    )
  }

  // 금액 조정은 어떤 결정이든 먼저 반영한다 — 반려해도 조정 이력은 남는다
  if (finalAmount !== undefined) {
    const [estimate] = await db
      .select({ id: estimates.id })
      .from(estimates)
      .where(eq(estimates.requestId, request.id))
      .orderBy(desc(estimates.version))
      .limit(1)
    if (estimate) {
      await db
        .update(estimates)
        .set({ finalAmount, adminId: admin.userId })
        .where(eq(estimates.id, estimate.id))
    }
  }

  const actor = { kind: 'admin' as const, id: admin.userId }

  if (action === 'approve_spec') {
    // 머지는 웹이 하지 않는다. 비가역적 동작은 러너의 몫이므로 job으로 넘긴다 (§1).
    // 이 job이 큐에 있다는 것 자체가 관리자가 승인했다는 뜻이다.
    const [pr] = await db
      .select({ id: pullRequests.id })
      .from(pullRequests)
      .where(
        and(
          eq(pullRequests.requestId, request.id),
          eq(pullRequests.kind, 'spec'),
          eq(pullRequests.status, 'open'),
        ),
      )
    if (!pr) {
      return NextResponse.json(
        { error: '머지할 Spec PR이 아직 없어요 — 명세 변경안 생성이 끝나지 않았습니다' },
        { status: 409 },
      )
    }

    await enqueueJob(db, {
      projectId: request.projectId,
      requestId: request.id,
      kind: 'spec_merge',
    })
    await logEvent(db, request.id, actor, { specApproved: true, finalAmount, comment })
    return NextResponse.json({ ok: true, status: 'merging' })
  }

  if (action === 'request_changes') {
    // 클라이언트에게 다시 물어야 하는 경우 — 접수 대화로 되돌린다
    await transition(db, request.id, 'awaiting_client', actor, { requestedChanges: comment })
    await logEvent(db, request.id, actor, { adminComment: comment })
    return NextResponse.json({ ok: true, status: 'awaiting_client' })
  }

  // reject — status는 보존하고 플래그로 얹는다 (§7)
  await db
    .update(changeRequests)
    .set({
      flag: 'cancelled',
      flagFromStatus: request.status,
      yourTurn: false,
      updatedAt: new Date(),
    })
    .where(eq(changeRequests.id, request.id))
  await logEvent(db, request.id, actor, { rejected: true, comment })

  return NextResponse.json({ ok: true, status: 'cancelled' })
}
