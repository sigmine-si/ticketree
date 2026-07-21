import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { projects } from '@ticketree/shared'
import { db, listRequests } from '@/lib/data'
import { getSession } from '@/lib/session'
import { TopBar } from '@/components/TopBar'
import { RequestList } from '@/components/RequestList'

// 목록은 SWR 폴링 대신 요청마다 새로 읽는다 — 캐시하면 진행 상황이 멈춰 보인다
export const dynamic = 'force-dynamic'

export default async function RequestsPage() {
  const session = await getSession()
  if (!session?.projectId) redirect('/dev-login')

  const [project] = await db.select().from(projects).where(eq(projects.id, session.projectId))
  if (!project) redirect('/dev-login')

  const rows = await listRequests(session.projectId)

  return (
    <>
      <TopBar projectName={project.name} userName={session.name} />
      <main className="wrap">
        <RequestList
          rows={rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }))}
        />
      </main>
    </>
  )
}
