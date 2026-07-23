/**
 * POST /api/admin/requests/[id]/scope — 관리자가 범위 판정을 조정한다
 *
 * `estimates.finalAmount`로는 부족하다. 그건 결정 라우트가 `client_approved`를
 * 요구해서 **클라이언트가 승인한 뒤에만** 조정된다. 범위 판정은 **클라이언트가 보기 전에**
 * 고쳐야 한다 — AI가 "추가 비용 없습니다"를 내보낸 뒤에 30만원을 매기면 조정이 아니라 번복이다.
 *
 * 그리고 finalAmount는 숫자만 바꾼다. 판정 문장과 근거가 그대로 남아 화면이
 * 자기모순이 된다("추가 비용 없음" 아래 ₩300,000).
 */
import { NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { changeRequests, estimates, logEvent, SCOPE_VERDICTS } from '@ticketree/shared'
import { db } from '@/lib/data'
import { requireAdmin, Unauthorized } from '@/lib/session'

const bodySchema = z.object({
  verdict: z.enum(SCOPE_VERDICTS),
  proposedAmount: z.number().int().nonnegative(),
  coveredAmount: z.number().int().nonnegative().optional(),
  /**
   * 클라이언트가 그대로 읽는 문장. 판정을 유지하는 경우에도 다시 쓰게 한다 —
   * 같은 문장을 다시 보여주고 끝내면 이의 제기가 무의미해진다.
   */
  clientNote: z.string().trim().min(1, '클라이언트에게 보여줄 설명을 적어주세요'),
  overrideNote: z.string().trim().min(1, '왜 그렇게 판단했는지 남겨주세요'),
})

/** 클라이언트가 아직 승인하기 전에만 고칠 수 있다. 승인 뒤는 번복이다. */
const EDITABLE = new Set(['estimating', 'quote_ready'])

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let admin
  try {
    admin = await requireAdmin()
  } catch (e) {
    if (e instanceof Unauthorized) {
      return NextResponse.json({ error: '관리자 로그인이 필요해요' }, { status: 401 })
    }
    throw e
  }

  const { id } = await ctx.params
  const [request] = await db.select().from(changeRequests).where(eq(changeRequests.id, id))
  if (!request) return NextResponse.json({ error: '요청을 찾을 수 없어요' }, { status: 404 })

  if (!EDITABLE.has(request.status)) {
    return NextResponse.json(
      { error: '클라이언트가 이미 견적을 본 뒤예요 — 지금 바꾸면 번복이 됩니다' },
      { status: 409 },
    )
  }

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '입력을 확인해주세요' },
      { status: 400 },
    )
  }
  const { verdict, proposedAmount, coveredAmount, clientNote, overrideNote } = parsed.data

  const [estimate] = await db
    .select({ id: estimates.id, before: estimates.scopeVerdict })
    .from(estimates)
    .where(eq(estimates.requestId, request.id))
    .orderBy(desc(estimates.version))
    .limit(1)
  if (!estimate) {
    return NextResponse.json({ error: '아직 견적이 없어요' }, { status: 409 })
  }

  await db
    .update(estimates)
    .set({
      scopeVerdict: verdict,
      proposedAmount,
      coveredAmount: coveredAmount ?? null,
      scopeClientNote: clientNote,
      // 뒤집는 순간 그건 AI의 추정이 아니라 회사의 약속이다. 서명이 남아야 한다.
      scopeOverriddenBy: admin.userId,
      scopeOverrideNote: overrideNote,
      // scopeBasis는 지우지 않는다 — AI가 무엇을 근거로 삼았는지가 감사 추적이다.
      // 사람이 뒤집었다는 사실을 그 위에 얹는 것이지 지우는 게 아니다.
    })
    .where(eq(estimates.id, estimate.id))

  // 이의 제기로 잠겨 있었다면 여기서 풀린다 — 공이 다시 클라이언트에게 간다
  if (request.flag === 'on_hold') {
    await db
      .update(changeRequests)
      .set({ flag: null, flagFromStatus: null, yourTurn: true, updatedAt: new Date() })
      .where(eq(changeRequests.id, request.id))
  }

  // 상태는 안 바뀐다 — transition이 아니라 사건만 기록한다
  await logEvent(
    db,
    request.id,
    { kind: 'admin', id: admin.userId },
    { scopeOverride: true, from: estimate.before, to: verdict, proposedAmount, overrideNote },
  )

  return NextResponse.json({ ok: true, verdict })
}
