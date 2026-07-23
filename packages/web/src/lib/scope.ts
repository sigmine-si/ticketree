/**
 * 프로젝트 스코프 게이트 — 주소 규약
 *
 * 주소의 slug는 **권한이 아니라 선택**이다. 접근 권한은 여전히 쿠키가 정한다.
 * 클라이언트 화면은 전부 이 함수를 첫 줄에서 지난다 — 지나지 않는 경로가 생기면
 * 그 화면만 스코프가 빠진다.
 *
 * session.ts에 두지 않는다. 그 파일은 쿠키와 서명만 알고 DB를 모른다.
 */
import { notFound, redirect } from 'next/navigation'
import { getProjectBySlug } from './data'
import { clientPath } from './routes'
import { getSession, type Session } from './session'

type Project = NonNullable<Awaited<ReturnType<typeof getProjectBySlug>>>

export interface ProjectAccess {
  session: Session
  project: Project
  /** false면 관리자 열람 — 화면에서 클라이언트용 버튼을 숨긴다 */
  canAct: boolean
}

export async function requireProjectAccess(slug: string): Promise<ProjectAccess> {
  const session = await getSession()
  if (!session) redirect(clientPath.login)

  const project = await getProjectBySlug(slug)
  if (!project) notFound()

  // 관리자는 어느 프로젝트든 들여다볼 수 있다. 대신 아무것도 누르지 못한다 —
  // 관리자가 클라이언트 대신 승인하면 "누가 승인했나"가 기록에서 흐려진다.
  // 실제 차단은 API 라우트의 requireClient가 한다. 여기서 하는 건 버튼을 숨기는 일뿐이다.
  if (session.kind === 'admin') return { session, project, canAct: false }

  // 남의 프로젝트는 403이 아니라 404다. 있다는 사실조차 알려주지 않는다
  // (lib/data.ts의 "다른 프로젝트의 요청은 없는 것과 같다"를 프로젝트 단위로 올린 것).
  if (session.projectId !== project.id) notFound()

  return { session, project, canAct: true }
}
