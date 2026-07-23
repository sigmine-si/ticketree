/**
 * POST /api/requests — 새 요청
 *
 * §2: 보내는 즉시 draft가 생성되고 탐색 job이 시작된다.
 * 제목은 여기서 만들지 않는다 — 첫 라운드 결과가 채운다 (§4).
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { allocateReqNo, changeRequests, enqueueJob, messages } from '@ticketree/shared'
import { db, getActiveSows } from '@/lib/data'
import { requireClient, Unauthorized } from '@/lib/session'

const bodySchema = z.object({
  asIs: z.string().trim().max(4000).optional(),
  // 필수 입력은 TO-BE 하나뿐이다 (§4)
  toBe: z.string().trim().min(1, 'TO-BE는 한 줄이라도 필요해요').max(4000),
  urgency: z.enum(['urgent', 'this_week', 'relaxed']).optional(),
})

export async function POST(req: Request) {
  let session
  try {
    session = await requireClient()
  } catch (e) {
    if (e instanceof Unauthorized) return NextResponse.json({ error: '로그인이 필요해요' }, { status: 401 })
    throw e
  }

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '입력을 확인해주세요' },
      { status: 400 },
    )
  }
  const { asIs, toBe, urgency } = parsed.data

  // 이 요청이 어느 계약 아래 놓이는지 **생성 시점에 고정한다.**
  // 나중에 다음 계약이 발효돼도 "무엇을 근거로 0원이었나"가 기록에 남아야 한다.
  const [activeSow] = await getActiveSows(session.projectId)

  const created = await db.transaction(async (tx) => {
    const reqNo = await allocateReqNo(tx as never, session.projectId)
    const [request] = await tx
      .insert(changeRequests)
      .values({
        projectId: session.projectId,
        reqNo,
        asIs: asIs || null,
        toBe,
        urgency: urgency ?? null,
        status: 'draft',
        createdBy: session.userId,
        sowId: activeSow?.id ?? null,
      })
      .returning({ id: changeRequests.id })

    await tx.insert(messages).values({
      requestId: request!.id,
      round: 0,
      role: 'client',
      content: asIs ? `지금: ${asIs}\n\n${toBe}` : toBe,
    })

    return { id: request!.id, reqNo }
  })

  // 큐 등록은 트랜잭션 밖에서 — 커밋 전에 러너가 집으면 요청을 못 찾는다
  await enqueueJob(db, {
    projectId: session.projectId,
    requestId: created.id,
    kind: 'exploration',
  })

  return NextResponse.json(created, { status: 201 })
}
