/**
 * 온보딩 job — spec.md §12
 *
 * 새 프로젝트를 붙일 때 한 번 돈다. 저장소를 읽고 명세 세 층(product·overview·
 * features)과 CLAUDE.md·digest.md 초안을 만들어 PR을 연다.
 *
 * 이 job만 특별한 점: **요청(request)이 없다.** 클라이언트가 낸 변경이 아니라
 * 프로젝트 자체를 세우는 일이라, 상태 전이도 없고 request_events도 남지 않는다.
 *
 * 초안이라는 점이 중요하다. 사람이 PR에서 고쳐 머지한다 — 자동으로 머지하지 않는다.
 * 명세는 클라이언트와의 계약서라 우리가 읽지 않은 채로 계약이 될 수 없다.
 */
import { eq } from 'drizzle-orm'
import {
  parseOnboardingResult,
  policyForJob,
  projects,
  pullRequests,
  type Db,
} from '@ticketree/shared'
import { runAgent } from '../agent/claude.js'
import { createProgressReader } from '../agent/progress.js'
import { statusTextFrom } from '../agent/status-text.js'
import { setStatusText, type ClaimedJob, type JobOutcome } from '../queue.js'
import {
  commitPaths,
  createPr,
  ensureClone,
  diffAgainstMain,
  hasChanges,
  headSha,
  prepareBranch,
  pushBranch,
} from '../git.js'

const ONBOARD_BRANCH = 'onboarding/spec'

const ONBOARD_SYSTEM = `당신은 외주 개발팀의 온보딩 담당이다. 새로 맡은 저장소를 읽고,
앞으로 이 프로젝트를 명세 기준으로 운영할 수 있게 문서의 뼈대를 만든다.

## 만들 것

1. \`specs/product.md\` — 이 서비스가 **무엇을 하는 물건인지**, 누가 쓰는지, 용어.
   코드에서 읽어낸 사실만 쓴다. 모르는 것은 지어내지 말고 "(확인 필요)"로 남긴다.
2. \`specs/overview.md\` — 전체 흐름. 어느 기능도 혼자 소유하지 않는 것만 담는다
   (주요 흐름, 데이터, 외부 연동).
3. \`specs/features/*.md\` — 기능별 명세. 파일명은 영문 소문자.
4. \`CLAUDE.md\` — 이 저장소에서 에이전트가 지킬 규칙. 코드에서 발견한 실제 관례를
   적는다(예: "금액 계산은 X 밖에서 하지 않는다").
5. \`digest.md\` — 코드 지도. 무엇이 어디에 있는지.

## 명세 형식

각 기능 명세는 이 구조를 지킨다.

\`\`\`
# 기능 이름

버전: v1.0 · 마지막 변경 <오늘 날짜>
순서: 1

## 이렇게 동작해요

- [x] 클라이언트가 읽을 수 있는 말로 쓴 동작 한 줄

## 알려진 제약

- 지금 안 되는 것

## 구현 규칙 (내부)

- 계산식·조건·경계값. 코드를 다시 뒤져야만 알 수 있는 것을 여기 남긴다.

## 변경 이력

- v1.0 <오늘 날짜> 온보딩 시 코드에서 정리
\`\`\`

- \`## 이렇게 동작해요\`는 **이미 동작하는 것**이므로 전부 \`- [x]\`다. 예정 항목은 없다.
- 계약(이렇게 동작해요)에는 파일명·함수명·기술 용어를 쓰지 않는다.
- 설계(구현 규칙)에는 코드에서 읽어낸 구체적인 규칙을 남긴다.
- \`순서:\`는 클라이언트가 서비스를 겪는 순서대로 매긴다.

## 규칙

- **코드를 읽고 쓴다.** 추측으로 명세를 만들지 않는다. 확신이 없으면 "(확인 필요)"를 붙인다.
- 기존 문서(README 등)가 있으면 참고하되, 그것이 코드와 다르면 코드를 믿고 차이를 적는다.
- **git 명령을 실행하지 않는다.** 브랜치·커밋·PR은 러너가 한다.
- 코드를 고치지 않는다. 이번 작업은 문서만이다.

## 출력 형식

맨 마지막에 \`\`\`json 블록 하나로 출력한다.

\`\`\`json
{
  "features": ["order", "settlement"],
  "summary": "관리자가 읽을 한 줄 요약",
  "unknowns": ["코드만 봐서는 알 수 없어 사람 확인이 필요한 것"]
}
\`\`\``

export async function runOnboardingJob(db: Db, job: ClaimedJob): Promise<JobOutcome> {
  const [project] = await db.select().from(projects).where(eq(projects.id, job.projectId))
  if (!project?.workspacePath) throw new Error(`project ${job.projectId} has no workspace_path`)
  if (!project.hubRepo) throw new Error(`project ${job.projectId} has no hub_repo`)

  const cwd = project.workspacePath
  // 이 저장소를 처음 보는 시점이다 — 워크스페이스가 없으면 여기서 만든다
  await ensureClone(project.hubRepo, cwd)
  await prepareBranch(cwd, ONBOARD_BRANCH)

  let lastText = ''
  const progress = createProgressReader()
  const show = (text: string) => {
    if (!text || text === lastText) return
    lastText = text
    void setStatusText(db, job.id, text).catch(() => {})
  }

  const run = await runAgent({
    prompt: [
      `${project.name} 저장소를 처음 맡았다. 코드를 읽고 명세와 규칙 문서의 초안을 만들어라.`,
      '',
      `클라이언트: ${project.clientName}`,
      '',
      '이미 있는 문서(README 등)를 먼저 훑고, 그 다음 실제 코드를 확인하라.',
      '문서와 코드가 다르면 코드를 믿고, 그 차이를 unknowns에 적어라.',
    ].join('\n'),
    cwd,
    policy: policyForJob('onboarding'),
    appendSystemPrompt: ONBOARD_SYSTEM,
    onTextDelta: (chunk) => {
      for (const line of progress.push(chunk)) show(line)
    },
    onEvent: (ev) => {
      if (lastText) return
      show(statusTextFrom(ev) ?? '')
    },
  })

  const result = parseOnboardingResult(run.text)
  const cost = {
    tokensIn: run.tokensIn,
    tokensOut: run.tokensOut,
    costUsd: run.costUsd,
    model: run.model,
  }

  if (!(await hasChanges(cwd))) throw new Error('에이전트가 문서를 만들지 않았습니다')

  // 문서만 커밋한다. 코드는 이번 job의 대상이 아니다.
  await commitPaths(cwd, ['specs', 'CLAUDE.md', 'digest.md'], `온보딩 — 명세와 규칙 초안\n\n${result.summary}`)
  const diff = await diffAgainstMain(cwd, 'specs', 'CLAUDE.md', 'digest.md')
  const sha = await headSha(cwd)
  await pushBranch(cwd, ONBOARD_BRANCH)

  const pr = await createPr(cwd, {
    branch: ONBOARD_BRANCH,
    title: `온보딩 — ${project.name} 명세 초안`,
    body: [
      result.summary,
      '',
      `### 정리된 기능\n${result.features.map((f) => `- ${f}`).join('\n')}`,
      result.unknowns.length
        ? `\n### 사람 확인이 필요한 것\n${result.unknowns.map((u) => `- ${u}`).join('\n')}`
        : '',
      '',
      '---',
      '**이건 초안입니다.** 읽고 고친 뒤 머지하세요 — 명세는 클라이언트와의 계약서라',
      '우리가 읽지 않은 채로 계약이 될 수 없습니다. 머지되면 이 프로젝트로 요청을 받을 수 있습니다.',
    ]
      .filter(Boolean)
      .join('\n'),
  })

  await db.insert(pullRequests).values({
    requestId: null,
    repoId: null,
    kind: 'onboarding',
    prNumber: pr.number,
    status: 'open',
    headSha: sha,
    branch: ONBOARD_BRANCH,
    diff,
  })

  await prepareBranch(cwd, 'main').catch(() => {})

  return {
    status: 'done',
    result: { ...result, pr_number: pr.number, url: pr.url } as never,
    ...cost,
  }
}
