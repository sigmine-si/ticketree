/**
 * GET /api/requests/[id]/stream — 접수 대화 버퍼링 (SSE)
 *
 * §13: 실시간은 전부 폴링이고, 접수 대화 버퍼링만 SSE다.
 * 웹은 러너와 직접 통신하지 않으므로(§6), 여기서 하는 일은 DB를 1.5초마다
 * 들여다보고 바뀐 것만 흘려보내는 릴레이다.
 */
import { and, desc, eq } from 'drizzle-orm'
import { changeRequests, jobs, messages } from '@ticketree/shared'
import { db, getRequestById } from '@/lib/data'
import { requireClient, Unauthorized } from '@/lib/session'

export const dynamic = 'force-dynamic'

const POLL_MS = 1500
/** 무한 스트림 방지 — 끊기면 브라우저가 다시 붙는다 */
const MAX_MS = 10 * 60_000

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  let session
  try {
    session = await requireClient()
  } catch (e) {
    if (e instanceof Unauthorized) return new Response('unauthorized', { status: 401 })
    throw e
  }

  const { id } = await ctx.params
  const request = await getRequestById(session.projectId, id)
  if (!request) return new Response('not found', { status: 404 })

  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      const startedAt = Date.now()
      let lastStatusText: string | null = null
      let lastMessageId: string | null = null

      while (!closed && Date.now() - startedAt < MAX_MS) {
        const [running] = await db
          .select({ statusText: jobs.statusText })
          .from(jobs)
          .where(and(eq(jobs.requestId, request.id), eq(jobs.status, 'running')))
          .limit(1)

        const [queued] = await db
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.requestId, request.id), eq(jobs.status, 'queued')))
          .limit(1)

        if (running) {
          const text = running.statusText ?? '관련 코드를 확인하고 있어요'
          if (text !== lastStatusText) {
            lastStatusText = text
            send('status', { text })
          }
        } else if (queued && lastStatusText === null) {
          lastStatusText = '곧 확인을 시작할게요'
          send('status', { text: lastStatusText })
        }

        const [latest] = await db
          .select({ id: messages.id, role: messages.role })
          .from(messages)
          .where(eq(messages.requestId, request.id))
          .orderBy(desc(messages.createdAt))
          .limit(1)

        // 에이전트 메시지가 새로 생겼고 실행 중인 job이 없으면 라운드가 끝난 것이다
        if (latest && latest.role === 'agent' && latest.id !== lastMessageId && !running) {
          lastMessageId = latest.id
          const [state] = await db
            .select({ status: changeRequests.status, flag: changeRequests.flag })
            .from(changeRequests)
            .where(eq(changeRequests.id, request.id))
          send('round', { messageId: latest.id, ...state })
          lastStatusText = null
        }

        if (!running && !queued && lastMessageId) {
          send('idle', {})
          break
        }

        await new Promise((r) => setTimeout(r, POLL_MS))
      }

      if (!closed) controller.close()
    },
    cancel() {
      closed = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
