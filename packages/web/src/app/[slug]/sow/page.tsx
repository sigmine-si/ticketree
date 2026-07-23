import { listSows } from '@/lib/data'
import { requireProjectAccess } from '@/lib/scope'
import { TopBar } from '@/components/TopBar'
import { SowList } from '@/components/SowList'

// 목록은 캐시하지 않는다 — 캐시하면 진행 상황이 멈춰 보인다
export const dynamic = 'force-dynamic'

export default async function SowsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { session, project, canAct } = await requireProjectAccess(slug)

  const rows = await listSows(project.id)

  return (
    <>
      <TopBar
        projectName={project.name}
        userName={session.name}
        slug={slug}
        canAct={canAct}
        active="sow"
      />
      <main className="wrap">
        <SowList
          slug={slug}
          canAct={canAct}
          rows={rows.map((r) => ({
            ...r,
            updatedAt: r.updatedAt.toISOString(),
            confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null,
          }))}
        />
      </main>
    </>
  )
}
