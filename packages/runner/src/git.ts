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
import { promisify } from 'node:util'

const exec = promisify(execFile)

async function run(bin: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await exec(bin, args, { cwd, maxBuffer: 20 * 1024 * 1024 })
  return stdout.trim()
}

export const git = (cwd: string, ...args: string[]) => run('git', args, cwd)
export const gh = (cwd: string, ...args: string[]) => run('gh', args, cwd)

export function specBranch(reqNo: number): string {
  return `spec/REQ-${String(reqNo).padStart(3, '0')}`
}

/**
 * main을 최신으로 맞추고 작업 브랜치를 연다.
 * 같은 이름의 브랜치가 이미 있으면 지우고 다시 딴다 — 재시도가 깨끗해야 한다.
 */
export async function prepareBranch(cwd: string, branch: string): Promise<void> {
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
export async function diffAgainstMain(cwd: string): Promise<string> {
  return git(cwd, 'diff', 'origin/main...HEAD', '--', 'specs/')
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
 * PR 머지. 이 함수는 관리자 승인 뒤 spec_merge job에서만 불린다.
 * 에이전트가 닿을 수 있는 코드 경로에 두지 않는다.
 */
export async function mergePr(cwd: string, prNumber: number): Promise<void> {
  await gh(cwd, 'pr', 'merge', String(prNumber), '--squash', '--delete-branch')
}
