/**
 * /{slug} — 프로젝트의 첫 화면은 요청 내역이다.
 *
 * 여기서 스코프 게이트를 먼저 지난다. 확인 없이 리다이렉트만 하면 이 라우트가
 * 최상위의 모든 주소를 삼킨다 — 브라우저가 찾는 /favicon.ico 까지 잡혀서
 * /favicon.ico/requests 로 한 번 튄 뒤에야 404가 났다.
 */
import { redirect } from 'next/navigation'
import { requireProjectAccess } from '@/lib/scope'
import { clientPath } from '@/lib/routes'

export const dynamic = 'force-dynamic'

export default async function ProjectHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  await requireProjectAccess(slug)
  redirect(clientPath.requests(slug))
}
