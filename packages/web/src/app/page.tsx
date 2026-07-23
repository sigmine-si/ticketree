/**
 * 루트 — 세션을 보고 갈 곳을 정한다.
 *
 * 클라이언트 화면 주소에는 프로젝트가 들어가므로(주소 규약)
 * 여기서 세션의 프로젝트를 slug로 바꿔준다. 주소를 모르는 사람이 들어오는
 * 유일한 입구라 이 변환은 여기 한 곳에만 있으면 된다.
 */
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { projects } from '@ticketree/shared'
import { db } from '@/lib/data'
import { getSession } from '@/lib/session'
import { adminPath, clientPath } from '@/lib/routes'

export default async function Home() {
  const session = await getSession()
  if (!session) redirect(clientPath.login)
  if (session.kind === 'admin') redirect(adminPath.queue)
  if (!session.projectId) redirect(clientPath.login)

  const [project] = await db
    .select({ slug: projects.slug })
    .from(projects)
    .where(eq(projects.id, session.projectId))
  // 쿠키가 가리키는 프로젝트가 사라진 경우 — 다시 로그인시킨다
  if (!project) redirect(clientPath.login)

  redirect(clientPath.requests(project.slug))
}
