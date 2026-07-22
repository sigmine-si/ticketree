/**
 * 도그푸딩 시드 — ticketree 자신을 프로젝트로 등록한다 (spec.md §16-8)
 *
 * 워크스페이스는 **개발 중인 저장소가 아니라 별도 클론**이다. 러너가
 * `git reset --hard origin/main`을 걸기 때문에, 작업 중인 트리를 워크스페이스로
 * 쓰면 커밋 안 한 변경이 날아간다.
 *
 * 재실행해도 안전하다 — 클론이 이미 있으면 main만 최신으로 맞춘다.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { closeDb, createDb } from './db/client'
import { projects, repos, users } from './db/schema'

const SLUG = 'ticketree'
const REPO = 'sigmine-si/ticketree'
const CLIENT = '시그마인'
const ROOT = resolve(process.cwd(), '../..')
const WS = join(ROOT, 'workspaces', SLUG)

/** 모노레포다. 구현 job이 커밋해도 되는 경로 (§9 projects.settings). */
const CODE_PATHS = ['packages', 'scripts', 'digest.md', 'README.md']

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function cloneOrSync(): void {
  if (!existsSync(join(WS, '.git'))) {
    mkdirSync(join(ROOT, 'workspaces'), { recursive: true })
    execFileSync('git', ['clone', `https://github.com/${REPO}.git`, WS], { stdio: 'inherit' })
    console.log(`cloned: ${WS}`)
    return
  }
  git(WS, 'fetch', 'origin', 'main')
  git(WS, 'checkout', 'main')
  git(WS, 'reset', '--hard', 'origin/main')
  console.log(`synced: ${WS} @ ${git(WS, 'rev-parse', '--short', 'HEAD')}`)
}

function checkRepoFiles(): void {
  const required = ['CLAUDE.md', 'digest.md', 'specs/features']
  const missing = required.filter((p) => !existsSync(join(WS, p)))
  if (missing.length > 0) {
    console.warn(
      `\n경고: 워크스페이스에 ${missing.join(', ')} 가 없습니다.` +
        `\n      origin/main 에 아직 push되지 않은 것 같습니다 — push 후 다시 실행하세요.\n`,
    )
  }
}

async function seedDb(): Promise<void> {
  const db = createDb()
  const [existing] = await db.select().from(projects).where(eq(projects.slug, SLUG))

  if (existing) {
    await db
      .update(projects)
      .set({
        workspacePath: WS,
        hubRepo: REPO,
        status: 'active',
        settings: { codePaths: CODE_PATHS },
      })
      .where(eq(projects.id, existing.id))
    console.log(`project ${SLUG}: updated (${existing.id})`)
    await closeDb()
    return
  }

  const [project] = await db
    .insert(projects)
    .values({
      slug: SLUG,
      name: 'Ticket Tree',
      clientName: CLIENT,
      status: 'active',
      hubRepo: REPO,
      workspacePath: WS,
      deployAdapter: 'manual',
      settings: { codePaths: CODE_PATHS },
    })
    .returning({ id: projects.id })

  await db.insert(repos).values({
    projectId: project!.id,
    name: 'app',
    githubFullName: REPO,
    role: '플랫폼 — 웹 포털과 러너',
    deployOrder: 1,
    deployAdapter: 'manual',
  })

  await db.insert(users).values({ projectId: project!.id, kind: 'client', name: CLIENT })
  console.log(`project ${SLUG}: created (${project!.id})`)
  await closeDb()
}

cloneOrSync()
checkRepoFiles()
await seedDb()
