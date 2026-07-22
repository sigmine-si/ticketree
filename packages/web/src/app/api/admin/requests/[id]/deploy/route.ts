/**
 * POST /api/admin/requests/[id]/deploy — 배포 승인 / 배포 완료 표시
 *
 * §1 마지막 게이트. 비가역적 동작(머지·배포)은 반드시 여기를 지나 러너가 실행한다.
 *  - approve   : in_review → 코드 PR 머지(deploy job)
 *  - mark_done : awaiting_manual_deploy → 예정 항목 정식 반영·종결(deploy_finalize job)
 *  - set_preview: manual 어댑터에서 운영자가 미리보기 URL을 직접 입력 (§16-6)
 */
import { NextResponse } from 'next/server'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { changeRequests, enqueueJob, logEvent, pullRequests } from '@ticketree/shared'
import { db } from '@/lib/data'
import { requireAdmin, Unauthorized } from '@/lib/session'

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('mark_done') }),
  z.object({ action: z.literal('set_preview'), previewUrl: z.string().url() }),
])

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
  if (!parsed.success) return NextResponse.json({ error: '입력을 확인해주세요' }, { status: 400 })
  const body = parsed.data
  const actor = { kind: 'admin' as const, id: admin.userId }

  if (body.action === 'set_preview') {
    const [pr] = await db
      .select({ id: pullRequests.id })
      .from(pullRequests)
      .where(and(eq(pullRequests.requestId, request.id), eq(pullRequests.kind, 'code')))
      .orderBy(desc(pullRequests.createdAt))
      .limit(1)
    if (!pr) return NextResponse.json({ error: '코드 PR이 없어요' }, { status: 409 })
    await db.update(pullRequests).set({ previewUrl: body.previewUrl }).where(eq(pullRequests.id, pr.id))
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'approve') {
    if (request.status !== 'in_review') {
      return NextResponse.json({ error: '지금은 배포 승인 단계가 아니에요' }, { status: 409 })
    }
    await enqueueJob(db, { projectId: request.projectId, requestId: request.id, kind: 'deploy' })
    await logEvent(db, request.id, actor, { deployApproved: true })
    return NextResponse.json({ ok: true, status: 'deploying' })
  }

  // mark_done
  if (request.status !== 'awaiting_manual_deploy') {
    return NextResponse.json({ error: '수동 배포 대기 상태가 아니에요' }, { status: 409 })
  }
  await enqueueJob(db, { projectId: request.projectId, requestId: request.id, kind: 'deploy_finalize' })
  await logEvent(db, request.id, actor, { markedDeployed: true })
  return NextResponse.json({ ok: true, status: 'finalizing' })
}
