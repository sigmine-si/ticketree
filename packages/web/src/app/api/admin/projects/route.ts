/**
 * POST /api/admin/projects — 새 프로젝트를 붙인다 (spec.md §12)
 *
 * 행만 만들고 나머지는 온보딩 job이 한다 — 저장소 복제, 코드 읽기, 명세 초안, PR.
 * 웹은 git을 만지지 않는다 (§1).
 */
import { resolve } from 'node:path'
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { enqueueJob, projects, repos, users } from '@ticketree/shared'
import { db } from '@/lib/data'
import { requireAdmin, Unauthorized } from '@/lib/session'

const bodySchema = z.object({
  /** 주소에 들어간다 — /{slug}/requests */
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}$/, '영문 소문자·숫자·하이픈으로 2~39자'),
  name: z.string().trim().min(1).max(60),
  clientName: z.string().trim().min(1).max(60),
  /** org/repo */
  hubRepo: z
    .string()
    .trim()
    .regex(/^[\w.-]+\/[\w.-]+$/, 'org/repo 형식이어야 해요'),
})

/** 워크스페이스 뿌리. 서버에서는 /srv/ticketree/workspaces 같은 곳을 가리킨다. */
function workspacesDir(): string {
  return process.env.WORKSPACES_DIR ?? resolve(process.cwd(), '../../workspaces')
}

export async function POST(req: Request) {
  try {
    await requireAdmin()
  } catch (e) {
    if (e instanceof Unauthorized) return NextResponse.json({ error: '권한이 없어요' }, { status: 401 })
    throw e
  }

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '입력을 확인해주세요' },
      { status: 400 },
    )
  }
  const { slug, name, clientName, hubRepo } = parsed.data

  const [dup] = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug))
  if (dup) return NextResponse.json({ error: '이미 있는 주소예요' }, { status: 409 })

  const [project] = await db
    .insert(projects)
    .values({
      slug,
      name,
      clientName,
      // 온보딩 PR을 머지하기 전에는 요청을 받지 않는다
      status: 'provisioning',
      hubRepo,
      workspacePath: resolve(workspacesDir(), slug),
      deployAdapter: 'manual',
    })
    .returning({ id: projects.id })

  await db.insert(repos).values({
    projectId: project!.id,
    name: 'app',
    githubFullName: hubRepo,
    deployOrder: 1,
    deployAdapter: 'manual',
  })
  await db.insert(users).values({ projectId: project!.id, kind: 'client', name: clientName })

  const jobId = await enqueueJob(db, { projectId: project!.id, kind: 'onboarding' })
  return NextResponse.json({ ok: true, projectId: project!.id, jobId })
}
