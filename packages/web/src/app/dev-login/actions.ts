'use server'

/**
 * 개발용 로그인 액션.
 *
 * 컴포넌트 안에 인라인으로 두지 않는다. 인라인 액션은 조건부 렌더(notFound 등)와
 * 얽히면 서버가 액션을 못 찾아 "Cannot read properties of undefined (reading 'bind')"로
 * 죽는다 — 실제로 그렇게 로그인이 막혀 있었다. 모듈 최상단 'use server'가 안전하다.
 */
import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { projects, users } from '@ticketree/shared'
import { db } from '@/lib/data'
import { devLoginEnabled, setSession } from '@/lib/session'
import { clientPath } from '@/lib/routes'

export async function devLogin(formData: FormData): Promise<void> {
  // 액션은 페이지 렌더와 별개의 요청이다 — 여기서도 다시 막는다
  if (!devLoginEnabled()) redirect('/login')

  const userId = String(formData.get('userId') ?? '')
  const [u] = await db
    .select({
      id: users.id,
      name: users.name,
      projectId: users.projectId,
      slug: projects.slug,
    })
    .from(users)
    .innerJoin(projects, eq(users.projectId, projects.id))
    .where(and(eq(users.id, userId), eq(users.kind, 'client')))

  if (!u?.projectId) redirect('/dev-login?error=notfound')

  await setSession({ userId: u.id, projectId: u.projectId, kind: 'client', name: u.name })
  redirect(clientPath.requests(u.slug))
}
