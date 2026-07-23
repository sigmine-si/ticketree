/**
 * POST /api/sows — 새 과업내용서
 *
 * 요청(`/api/requests`)과 같은 테이블에 들어가되 kind='sow'다.
 * 폼이 다르다 — AS-IS/TO-BE/긴급도가 아니라 "무엇을 만들려는가" 하나다.
 * 계약을 시작하는 자리라 지금 상태(AS-IS)가 없고, 급한 정도로 가를 일도 아니다.
 *
 * 제목은 여기서 만들지 않는다 — 첫 라운드 결과가 채운다.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { allocateNo, changeRequests, enqueueJob, messages } from '@ticketree/shared'
import { db } from '@/lib/data'
import { requireClient, Unauthorized } from '@/lib/session'

const bodySchema = z.object({
  background: z
    .string()
    .trim()
    .min(1, '무엇을 만들고 싶은지 한 줄이라도 적어주세요')
    .max(8000),
})

export async function POST(req: Request) {
  let session
  try {
    session = await requireClient()
  } catch (e) {
    if (e instanceof Unauthorized) {
      return NextResponse.json({ error: '로그인이 필요해요' }, { status: 401 })
    }
    throw e
  }

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '입력을 확인해주세요' },
      { status: 400 },
    )
  }
  const { background } = parsed.data

  const created = await db.transaction(async (tx) => {
    // 요청과 번호 공간이 다르다 — SOW-001은 REQ-001과 별개다
    const sowNo = await allocateNo(tx as never, session.projectId, 'sow')
    const [sow] = await tx
      .insert(changeRequests)
      .values({
        projectId: session.projectId,
        kind: 'sow',
        reqNo: sowNo,
        toBe: background,
        status: 'draft',
        createdBy: session.userId,
      })
      .returning({ id: changeRequests.id })

    await tx.insert(messages).values({
      requestId: sow!.id,
      round: 0,
      role: 'client',
      content: background,
    })

    return { id: sow!.id, sowNo }
  })

  // 큐 등록은 트랜잭션 밖에서 — 커밋 전에 러너가 집으면 요청을 못 찾는다
  await enqueueJob(db, {
    projectId: session.projectId,
    requestId: created.id,
    kind: 'sow_intake',
  })

  return NextResponse.json(created, { status: 201 })
}
