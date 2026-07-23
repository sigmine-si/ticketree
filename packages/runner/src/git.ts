/**
 * git·GitHub 조작 — spec.md §1, §6
 *
 * 에이전트가 아니라 러너가 한다. 두 가지 이유가 있다.
 *  1. 브랜치명·커밋 메시지가 결정적이어야 추적이 된다.
 *  2. 머지는 비가역적이라 반드시 사람의 승인 뒤에 와야 한다.
 *
 * 인증은 로컬에 로그인된 gh를 그대로 쓴다. 서버에서는 GitHub App 토큰으로
 * 바뀌지만 이 파일 밖은 그 차이를 모른다.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

async function run(bin: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await exec(bin, args, { cwd, maxBuffer: 20 * 1024 * 1024 })
  return stdout.trim()
}

export const git = (cwd: string, ...args: string[]) => run('git', args, cwd)
export const gh = (cwd: string, ...args: string[]) => run('gh', args, cwd)

const tag = (reqNo: number) => `REQ-${String(reqNo).padStart(3, '0')}`
export function specBranch(reqNo: number): string {
  return `spec/${tag(reqNo)}`
}
export function devBranch(reqNo: number): string {
  return `dev/${tag(reqNo)}`
}

/**
 * main을 최신으로 맞추고 작업 브랜치를 연다.
 * 같은 이름의 브랜치가 이미 있으면 지우고 다시 딴다 — 재시도가 깨끗해야 한다.
 */
export async function prepareBranch(cwd: string, branch: string): Promise<void> {
  // --prune: 사라진 원격 브랜치의 추적 ref를 지운다. 남아 있으면 나중에
  // push --force-with-lease 가 그 낡은 ref를 근거로 거부한다.
  await git(cwd, 'fetch', '--prune', 'origin').catch(() => {})
  await git(cwd, 'fetch', 'origin', 'main')
  await git(cwd, 'checkout', 'main')
  await git(cwd, 'reset', '--hard', 'origin/main')
  await git(cwd, 'checkout', '-B', branch)
}

/** 워킹 트리에 변경이 있는지. 에이전트가 아무것도 안 고쳤을 수 있다. */
export async function hasChanges(cwd: string): Promise<boolean> {
  return (await git(cwd, 'status', '--porcelain')) !== ''
}

/** 커밋 대상 경로를 제한한다 — 에이전트가 엉뚱한 걸 고쳤어도 명세만 올라간다. */
export async function commitPaths(
  cwd: string,
  paths: string[],
  message: string,
): Promise<void> {
  await git(cwd, 'add', '--', ...paths)
  await git(cwd, 'commit', '-m', message)
}

export async function pushBranch(cwd: string, branch: string): Promise<void> {
  await git(cwd, 'push', '--force-with-lease', '-u', 'origin', branch)
}

/** main 대비 diff. 검토 화면이 GitHub을 다시 부르지 않도록 여기서 잡아둔다. */
export async function diffAgainstMain(cwd: string, ...paths: string[]): Promise<string> {
  const scope = paths.length ? paths : ['.']
  return git(cwd, 'diff', 'origin/main', '--', ...scope)
}

/**
 * 구현 작업장을 연다 — 별개 worktree. 프로젝트·레인 락이 동시 실행을 막지만,
 * worktree는 main 체크아웃(명세 화면이 읽는다)과 물리적으로 분리해준다 (§6).
 * 같은 이름이 남아 있으면 지우고 새로 판다 — 재시도가 깨끗해야 한다.
 */
export async function addWorktree(
  mainCwd: string,
  worktreePath: string,
  branch: string,
): Promise<void> {
  await git(mainCwd, 'fetch', 'origin', 'main')
  await git(mainCwd, 'worktree', 'remove', '--force', worktreePath).catch(() => {})
  await git(mainCwd, 'branch', '-D', branch).catch(() => {})
  await git(mainCwd, 'worktree', 'add', '-b', branch, worktreePath, 'origin/main')
}

export async function removeWorktree(mainCwd: string, worktreePath: string): Promise<void> {
  await git(mainCwd, 'worktree', 'remove', '--force', worktreePath).catch(() => {})
}

/**
 * 에이전트가 남긴 커밋을 지우되 파일 변경은 유지한다.
 * 커밋 메시지·경로를 러너가 결정적으로 다시 만들기 위해, 에이전트가 중간에
 * git을 만졌더라도 여기서 origin/main 기준으로 되돌린다.
 */
export async function resetToMainKeepingChanges(cwd: string): Promise<void> {
  await git(cwd, 'reset', '--mixed', 'origin/main')
}

export interface CreatedPr {
  number: number
  url: string
}

export async function createPr(
  cwd: string,
  opts: { title: string; body: string; branch: string },
): Promise<CreatedPr> {
  const url = await gh(
    cwd,
    'pr',
    'create',
    '--base',
    'main',
    '--head',
    opts.branch,
    '--title',
    opts.title,
    '--body',
    opts.body,
  )
  const number = Number(url.trim().split('/').pop())
  if (!Number.isInteger(number)) throw new Error(`PR 번호를 읽지 못했습니다: ${url}`)
  return { number, url: url.trim() }
}

export async function headSha(cwd: string): Promise<string> {
  return git(cwd, 'rev-parse', 'HEAD')
}

/**
 * 워크스페이스를 origin/main에 맞춘다.
 * 명세 화면이 이 파일들을 읽으므로 머지 직후 반드시 부른다.
 */
export async function syncMain(cwd: string): Promise<void> {
  await git(cwd, 'fetch', 'origin', 'main')
  await git(cwd, 'checkout', 'main')
  await git(cwd, 'reset', '--hard', 'origin/main')
}

/**
 * 워크스페이스가 없으면 복제한다. 온보딩은 이 저장소를 처음 보는 시점이라
 * 클론부터가 job의 일부다 (§12).
 */
export async function ensureClone(repoFullName: string, path: string): Promise<void> {
  if (existsSync(join(path, '.git'))) return
  await mkdir(dirname(path), { recursive: true })
  await exec('git', ['clone', `https://github.com/${repoFullName}.git`, path], {
    maxBuffer: 20 * 1024 * 1024,
  })
}

/**
 * 작업 브랜치를 최신 main에 맞춘다. PR을 만든 뒤 main이 움직이면 머지가 막힌다 —
 * 요청이 여러 개 동시에 돌면 반드시 일어나는 일이다.
 *
 * 겹치지 않는 변경은 여기서 조용히 풀린다(파일이 다르거나 줄이 다른 경우).
 * 같은 줄이 양쪽에서 바뀐 진짜 충돌만 false로 돌려보내 사람에게 넘긴다 —
 * 러너가 임의로 한쪽을 고르면 승인된 내용과 다른 것이 머지된다.
 */
export async function syncBranchWithMain(cwd: string, branch: string): Promise<boolean> {
  await git(cwd, 'fetch', '--prune', 'origin').catch(() => {})
  await git(cwd, 'fetch', 'origin', 'main')
  await git(cwd, 'checkout', branch)
  await git(cwd, 'reset', '--hard', `origin/${branch}`)

  try {
    await git(cwd, 'merge', '--no-edit', 'origin/main')
  } catch {
    // 작업 트리를 충돌 상태로 남기지 않는다 — 다음 job이 여기서 시작한다
    await git(cwd, 'merge', '--abort').catch(() => {})
    await git(cwd, 'checkout', 'main').catch(() => {})
    return false
  }

  // 머지 커밋이 생겼으면 올린다. 아무것도 안 바뀌었으면 push는 no-op이다.
  await git(cwd, 'push', 'origin', `${branch}:${branch}`)
  await git(cwd, 'checkout', 'main').catch(() => {})
  return true
}

/**
 * PR을 닫는다. 머지가 아니라 폐기다 — 명세를 다시 쓸 때 옛 PR을 정리한다.
 * 브랜치도 같이 지운다. 다음 시도가 깨끗한 브랜치에서 시작해야 한다.
 */
export async function closePr(cwd: string, prNumber: number, comment: string): Promise<void> {
  await gh(cwd, 'pr', 'close', String(prNumber), '--delete-branch', '--comment', comment)
  // 원격 브랜치가 사라졌으니 추적 ref를 정리한다. 안 하면 다음 push의
  // --force-with-lease 가 낡은 ref를 근거로 "stale info"를 내며 거부한다.
  await git(cwd, 'fetch', '--prune', 'origin').catch(() => {})
}

/**
 * PR 머지. 이 함수는 관리자 승인 뒤 spec_merge job에서만 불린다.
 * 에이전트가 닿을 수 있는 코드 경로에 두지 않는다.
 */
export async function mergePr(cwd: string, prNumber: number): Promise<void> {
  await gh(cwd, 'pr', 'merge', String(prNumber), '--squash', '--delete-branch')
}
