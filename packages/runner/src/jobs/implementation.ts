/**
 * 구현 job — spec.md §2, §6
 *
 * 승인된 요청을 받아 실제 코드를 고치고 코드 PR을 연다.
 * 작업 레인(Opus, 쓰기 가능, cwd = work/{REQ}/ worktree)에서 돈다.
 * 에이전트는 코드를 고치고, git·PR은 러너가 한다 (§1).
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { and, desc, eq } from 'drizzle-orm'
import {
  changeRequests,
  codePathsOf,
  estimates,
  messages,
  parseImplementationResult,
  pendingNotices,
  policyForJob,
  projects,
  pullRequests,
  repos,
  transition,
  type Db,
  type EstimationResult,
  type IntakeResult,
} from '@ticketree/shared'
import { runAgent } from '../agent/claude.js'
import { statusTextFrom } from '../agent/status-text.js'
import { setStatusText, type ClaimedJob, type JobOutcome } from '../queue.js'
import {
  addWorktree,
  commitPaths,
  createPr,
  devBranch,
  diffAgainstMain,
  hasChanges,
  headSha,
  pushBranch,
  removeWorktree,
  resetToMainKeepingChanges,
} from '../git.js'

const AGENT = { kind: 'agent' as const }

/**
 * 고칠 수 있는 경로는 프로젝트마다 다르다 (projects.settings.codePaths).
 * 단일 저장소는 `src/`, 모노레포는 `packages/` 처럼 갈린다.
 */
const implSystem = (codePaths: string[]): string => `당신은 외주 개발팀의 구현 담당이다. 승인된 명세를 코드로 옮긴다.

## 기준은 명세다

\`specs/features/\`에 이번 요청(REQ 번호)으로 추가된 \`- [ ] (예정 · REQ-xxx)\` 항목이 이번 작업의
수용 기준이다. 그 항목이 사실이 되도록 코드를 고친다. 명세에 없는 기능을 넣지 않는다.

## 규칙

- ${codePaths.map((p) => `\`${p}\``).join(' · ')} 안에서만 고친다. 이 밖의 변경은 커밋되지 않고 버려진다.
- \`specs/\`는 이미 승인·머지됐으니 건드리지 않는다.
- 기존 코드의 규칙을 따른다. CLAUDE.md와 digest.md를 먼저 읽어라
  (예: "금액 계산은 fee.ts 밖에서 하지 않는다" 같은 규칙).
- 테스트가 있으면 돌려서 통과를 확인한다. 없으면 만들지 여부는 작업 규모에 맞게 판단한다.
- 코드 지도(digest.md)에 새 파일·중요한 변화가 생겼으면 갱신한다.
- **git 명령을 실행하지 않는다.** 커밋·브랜치·PR·머지는 러너가 한다. 코드만 고치면 된다.

## 막히면

명세만으로는 판단할 수 없는 문제(기존 동작과 충돌, 명세가 모순적, 외부 자격증명 필요 등)를
만나면 억지로 진행하지 말고 blocker에 적는다. 그러면 사람에게 넘어간다.

## 출력 형식

작업을 마친 뒤 맨 마지막에 \`\`\`json 블록 하나로 출력한다.

\`\`\`json
{
  "summary": "무엇을 어떻게 구현했는지 — 관리자가 읽는다",
  "changed_files": ["${codePaths[0] ?? 'src'}/... 실제로 고친 파일"],
  "tests": "passed | none | failed",
  "notes": "미리보기로 확인할 지점 등",
  "blocker": null
}
\`\`\``

export async function runImplementationJob(db: Db, job: ClaimedJob): Promise<JobOutcome> {
  if (!job.requestId) throw new Error('implementation job requires a request_id')

  const [request] = await db
    .select()
    .from(changeRequests)
    .where(eq(changeRequests.id, job.requestId))
  if (!request?.reqNo) throw new Error('확정되지 않은 요청은 구현하지 않는다')

  const [project] = await db.select().from(projects).where(eq(projects.id, job.projectId))
  if (!project?.workspacePath) throw new Error(`project ${job.projectId} has no workspace_path`)

  const [repo] = await db.select().from(repos).where(eq(repos.projectId, project.id))
  if (!repo) throw new Error(`project ${job.projectId} has no repo`)

  const [lastAgent] = await db
    .select({ payload: messages.payload })
    .from(messages)
    .where(and(eq(messages.requestId, request.id), eq(messages.role, 'agent')))
    .orderBy(desc(messages.round))
    .limit(1)
  const intake = lastAgent?.payload as IntakeResult | null

  const [estimate] = await db
    .select({ wbs: estimates.wbs })
    .from(estimates)
    .where(eq(estimates.requestId, request.id))
    .orderBy(desc(estimates.version))
    .limit(1)
  const estimation = estimate?.wbs as EstimationResult | null

  // 운영자 해석 — 앞서 막혀 에스컬레이션됐다가 답을 받고 재개하는 경우 (§5)
  const operatorNotes = (
    await db
      .select({ content: messages.content })
      .from(messages)
      .where(and(eq(messages.requestId, request.id), eq(messages.role, 'system')))
      .orderBy(desc(messages.round))
      .limit(3)
  )
    .map((m) => m.content)
    .reverse()

  const codePaths = codePathsOf(project.settings)
  const reqTag = `REQ-${String(request.reqNo).padStart(3, '0')}`
  const branch = devBranch(request.reqNo)
  const worktree = join(project.workspacePath, 'work', reqTag)

  await mkdir(dirname(worktree), { recursive: true })
  await addWorktree(project.workspacePath, worktree, branch)

  await transition(db, request.id, 'developing', AGENT, { jobId: job.id })

  const prompt = [
    `${reqTag} 요청이 승인됐다. 명세에 추가된 예정 항목이 사실이 되도록 코드를 구현하라.`,
    '',
    intake?.summary ? `## ${intake.summary.title}` : `## ${request.title ?? reqTag}`,
    '',
    '**이번 요청으로 바뀌어야 하는 동작 (명세 기준)**',
    ...(intake?.summary?.scope.map((s) => `- ${s}`) ?? [`- ${request.toBe}`]),
    '',
    `\`specs/features/\`에서 \`(예정 · ${reqTag})\` 태그가 붙은 항목을 찾아 그것을 수용 기준으로 삼아라.`,
    estimation?.wbs?.length
      ? `\n**견적 단계의 작업 분해 (참고)**\n${estimation.wbs.map((w) => `- ${w.task}`).join('\n')}`
      : '',
    estimation?.risks?.length
      ? `\n**주의할 위험 (견적 단계에서 지적됨)**\n${estimation.risks.map((r) => `- ${r}`).join('\n')}`
      : '',
    operatorNotes.length
      ? `\n**운영자 지침 (앞서 막힌 지점에 대한 우리 팀의 결정 — 그대로 따르고 되묻지 않는다)**\n${operatorNotes.map((n) => `- ${n}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  let lastText = ''
  try {
    const run = await runAgent({
      prompt,
      cwd: worktree,
      policy: policyForJob('implementation'),
      appendSystemPrompt: implSystem(codePaths),
      onEvent: (ev) => {
        const text = statusTextFrom(ev)
        if (text && text !== lastText) {
          lastText = text
          void setStatusText(db, job.id, text).catch(() => {})
        }
      },
    })

    const result = parseImplementationResult(run.text)
    const cost = {
      tokensIn: run.tokensIn,
      tokensOut: run.tokensOut,
      costUsd: run.costUsd,
      model: run.model,
    }

    // 에이전트가 남긴 커밋을 지우고 러너가 결정적으로 다시 커밋한다
    await resetToMainKeepingChanges(worktree)
    const changed = await hasChanges(worktree)

    // 코드를 고쳤으면, blocker가 있어도 PR로 보존한다.
    // 정확한 작업을 버리지 않는다 — 사람이 이어받을 수 있게 남긴다.
    let prNumber: number | null = null
    let prUrl: string | null = null
    if (changed) {
      await commitPaths(
        worktree,
        codePaths,
        `${reqTag} ${intake?.summary?.title ?? request.title ?? '구현'}\n\n${result.summary}`,
      )
      const diff = await diffAgainstMain(worktree, ...codePaths)
      const sha = await headSha(worktree)
      await pushBranch(worktree, branch)

      const pr = await createPr(worktree, {
        branch,
        title: `${reqTag} ${intake?.summary?.title ?? request.title ?? '구현'}`,
        body: [
          result.summary,
          '',
          `### 검증\n테스트: ${result.tests === 'passed' ? '통과' : result.tests === 'failed' ? '실패' : '해당 없음'}`,
          result.notes ? `\n### 확인 사항\n${result.notes}` : '',
          result.blocker ? `\n### 미완 — 사람 확인 필요\n${result.blocker}` : '',
          '',
          '---',
          '이 PR은 Ticket Tree가 생성했습니다. 머지·배포는 관리자 승인 뒤 러너가 합니다.',
        ]
          .filter(Boolean)
          .join('\n'),
      })
      prNumber = pr.number
      prUrl = pr.url

      await db.insert(pullRequests).values({
        requestId: request.id,
        repoId: repo.id, // 코드 PR은 repo에 속한다 (§9)
        kind: 'code',
        prNumber: pr.number,
        status: 'open',
        headSha: sha,
        branch,
        diff,
      })
    }

    if (result.blocker) {
      // 명세로는 판단할 수 없는 문제 — 사람에게 넘긴다. PR이 있으면 부분 작업이 그대로 보인다.
      // status는 developing에서 벗어나되(실행 중 아님) 플래그로 얹는다 (§5, §7).
      await db
        .update(changeRequests)
        .set({ flag: 'escalated', flagFromStatus: 'developing', yourTurn: false, updatedAt: new Date() })
        .where(eq(changeRequests.id, request.id))
      await transition(db, request.id, 'queued_dev', AGENT, { blocker: result.blocker, prNumber })
      await db.insert(pendingNotices).values({ requestId: request.id, type: 'escalated' })
      return { status: 'done', result: { ...result, pr_number: prNumber, url: prUrl } as never, ...cost }
    }

    if (!changed) throw new Error('에이전트가 코드를 고치지 않았습니다')

    // 미리보기 확인 단계로 (§7). manual 어댑터는 preview_url을 운영자가 채운다 (§16-6)
    await transition(db, request.id, 'in_review', AGENT, { prNumber })

    return { status: 'done', result: { ...result, pr_number: prNumber, url: prUrl } as never, ...cost }
  } finally {
    // 작업장은 치우되 브랜치는 PR을 위해 남긴다
    await removeWorktree(project.workspacePath, worktree)
  }
}
