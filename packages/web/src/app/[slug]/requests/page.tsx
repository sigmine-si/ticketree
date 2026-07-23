import { listRequests } from '@/lib/data'
import { requireProjectAccess } from '@/lib/scope'
import { TopBar } from '@/components/TopBar'
import { RequestList } from '@/components/RequestList'

// 목록은 SWR 폴링 대신 요청마다 새로 읽는다 — 캐시하면 진행 상황이 멈춰 보인다
export const dynamic = 'force-dynamic'

export default async function RequestsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { session, project, canAct } = await requireProjectAccess(slug)

  const rows = await listRequests(project.id)

  return (
    <>
      <TopBar projectName={project.name} userName={session.name} slug={slug} canAct={canAct} />
      <main className="wrap">
        <RequestList
          slug={slug}
          canAct={canAct}
          rows={rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }))}
        />
      </main>
    </>
  )
}
