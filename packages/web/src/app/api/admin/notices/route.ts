/**
 * POST /api/admin/notices — 알림 읽음 처리
 *
 * 알림은 지우지 않고 dismissed_at 을 찍는다. 무슨 일이 언제 있었는지는
 * 감사 추적의 일부라 남겨둔다 (§7).
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { dismissNotices } from '@/lib/admin'
import { requireAdmin, Unauthorized } from '@/lib/session'

const bodySchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) })

export async function POST(req: Request) {
  try {
    await requireAdmin()
  } catch (e) {
    if (e instanceof Unauthorized) return NextResponse.json({ error: '권한이 없어요' }, { status: 401 })
    throw e
  }

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: '입력을 확인해주세요' }, { status: 400 })

  await dismissNotices(parsed.data.ids)
  return NextResponse.json({ ok: true })
}
