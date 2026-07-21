/**
 * POST /api/requests/[id]/answer — 질문에 답한다
 *
 * §16-2: 질문 하나씩 답할 수 있다. 한 라운드의 모든 질문이 답변되는 순간에만
 * 다음 intake_round job이 등록된다 — 부분 답변으로 에이전트를 깨우지 않는다.
 */
import { NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { enqueueJob, logEvent, messageQuestions, messages } from '@ticketree/shared'
// messages는 질문 소속 검증(innerJoin)에만 쓴다
import { db, getRequestById } from '@/lib/data'
import { requireClient, Unauthorized } from '@/lib/session'

const bodySchema = z.object({
  questionId: z.string().uuid(),
  answer: z.string().trim().min(1, '답변을 입력해주세요').max(2000),
  optionIdx: z.number().int().nonnegative().nullable().optional(),
})

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
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

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '입력을 확인해주세요' },
      { status: 400 },
    )
  }
  const { questionId, answer, optionIdx } = parsed.data

  // 질문이 이 요청에 속하는지 확인한다 — id만 믿지 않는다
  const [question] = await db
    .select({ id: messageQuestions.id, messageId: messageQuestions.messageId })
    .from(messageQuestions)
    .innerJoin(messages, eq(messageQuestions.messageId, messages.id))
    .where(and(eq(messageQuestions.id, questionId), eq(messages.requestId, request.id)))
  if (!question) return NextResponse.json({ error: '질문을 찾을 수 없어요' }, { status: 404 })

  await db
    .update(messageQuestions)
    .set({ answerText: answer, answerOptionIdx: optionIdx ?? null, answeredAt: new Date() })
    .where(eq(messageQuestions.id, questionId))

  const remaining = await db
    .select({ id: messageQuestions.id })
    .from(messageQuestions)
    .where(
      and(
        eq(messageQuestions.messageId, question.messageId),
        isNull(messageQuestions.answeredAt),
      ),
    )

  if (remaining.length > 0) {
    await logEvent(db, request.id, { kind: 'client', id: session.userId }, { answered: questionId })
    return NextResponse.json({ remaining: remaining.length, queued: false })
  }

  // 라운드 완결 — 이제 에이전트를 깨운다.
  //
  // 답변을 별도 메시지로 복사하지 않는다. 답은 이미 message_questions에 있고,
  // 스레드는 질문 카드 안에 인라인으로 보여준다. 복사본을 만들면 클라이언트 화면에
  // 같은 내용이 두 번 나오고, 에이전트도 그 복사본을 읽지 않는다(buildResumePrompt 참조).
  await enqueueJob(db, {
    projectId: session.projectId,
    requestId: request.id,
    kind: 'intake_round',
  })

  return NextResponse.json({ remaining: 0, queued: true })
}
