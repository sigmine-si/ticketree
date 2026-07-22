/**
 * 명세 변경안 job — spec.md §2, §6
 *
 * 확정된 변경 요청서를 읽고 허브 repo의 명세를 고쳐 PR을 연다.
 * 에이전트는 파일만 고치고, git과 PR은 러너가 한다 (§1).
 */
import { and, desc, eq } from 'drizzle-orm'
import {
  changeRequests,
  estimates,
  messages,
  parseSpecDraftResult,
  policyForJob,
  projects,
  pullRequests,
  specVersions,
  type Db,
  type EstimationResult,
  type IntakeResult,
} from '@ticketree/shared'
import { runAgent } from '../agent/claude.js'
import { statusTextFrom } from '../agent/status-text.js'
import { setStatusText, type ClaimedJob, type JobOutcome } from '../queue.js'
import {
  commitPaths,
  createPr,
  diffAgainstMain,
  hasChanges,
  headSha,
  prepareBranch,
  pushBranch,
  specBranch,
} from '../git.js'

const SPEC_SYSTEM = `당신은 외주 개발팀의 명세 담당이다. 확정된 변경 요청서를 받아 프로젝트 명세를 고친다.

## 명세가 무엇인가

명세 한 장에 **계약과 설계가 함께** 있다. 읽는 사람이 둘이라 섹션으로 가른다.

**\`## 이렇게 동작해요\` — 계약.** 클라이언트가 읽고 "그래, 이렇게 동작하기로 했지"라고
승인하는 문장이다. 클라이언트 화면에 그대로 나간다.

- **클라이언트의 말로 쓴다.** 파일명·함수명·기술 용어를 쓰지 않는다.
  "PriceCalculator에 쿠폰 할인을 추가한다"가 아니라 "결제할 때 보유한 쿠폰이 자동으로 적용된다".
- **무엇이 일어나는가로 쓴다.** 어떻게 구현하는지는 여기가 아니다.
- **검증 가능하게 쓴다.** 배포 후 이 문장 하나로 테스트할 수 있어야 한다.

**\`## 구현 규칙 (내부)\` — 설계.** 우리가 지켜야 하는 구체적인 규칙이다.
클라이언트 화면에는 나가지 않는다. 관리자와 구현 담당이 읽는다.

- 계산식·조건·경계값을 정확히 적는다. "5일 뒤(캘린더 기준, 주말·공휴일 포함)"처럼.
- 엣지 케이스와 빈 상태를 적는다. 계약 문장 하나로는 안 드러나는 것들이다.
- **아직 못 정한 것은 "(미정)"으로 남긴다.** 비워두면 구현 담당이 혼자 정하게 된다.
- 왜 그렇게 정했는지 한 줄 붙인다. 다음 요청이 이걸 읽고 같은 판단을 반복하지 않는다.

여기가 이 문서의 값이다. 코드를 다시 뒤져야 알 수 있는 것을 여기에 남긴다.

## 해야 할 일

1. \`specs/features/\`를 읽고 이번 변경이 어느 기능에 속하는지 정한다.
   맞는 파일이 없으면 새로 만든다(파일명은 영문 소문자, 예: coupon.md).
2. 해당 파일의 "이렇게 동작해요" 목록에 이번 변경으로 생길 항목을 추가한다.
   **아직 배포 전이므로 반드시 아래 형식으로 적는다:**
   \`- [ ] (예정 · REQ-014) 스탬프 10개를 모으면 무료 음료 쿠폰이 자동으로 발급된다\`
2-1. **\`## 구현 규칙 (내부)\` 을 갱신한다.** 아래 프롬프트로 받은 탐색 노트와 견적 단계의
   위험 요소에서, 코드를 다시 뒤져야만 알 수 있는 것을 여기로 옮긴다. 섹션이 없으면 만든다
   (자리는 "알려진 제약"과 "변경 이력" 사이). 이번 요청과 무관한 기존 규칙은 건드리지 않는다.
3. 기존 항목의 동작이 바뀐다면 그 줄을 고치고, 무엇이 어떻게 바뀌는지 변경 이력에 남긴다.
4. 파일 맨 위 버전을 올리고(v1.2 → v1.3) "변경 이력"에 한 줄 추가한다.
   **날짜를 넣는다** — 형식은 \`- v1.3 (REQ-014) 2026-07-22 스탬프 10개 도달 시 쿠폰 자동 발급 규칙 추가\`
5. 파일을 새로 만들 때는 머리말에 \`순서: N\`을 넣는다. 클라이언트가 서비스를 겪는
   순서대로 정한다(접수 → 결제 → 배송처럼). 기존 파일들의 순서를 보고 자리를 잡는다.

\`## 알려진 제약\` 같은 섹션도 클라이언트 화면에 그대로 나온다. 이번 변경으로 생기는
제약이 있으면 숨기지 말고 거기에 적는다.

## 하지 말아야 할 일

- **git 명령을 실행하지 않는다.** 브랜치·커밋·PR은 러너가 한다. 파일만 고치면 된다.
- \`specs/\` 밖의 파일을 고치지 않는다. 코드는 이번 job의 대상이 아니다.
- 요청서에 없는 기능을 명세에 넣지 않는다. 범위를 늘리지 않는다.

## 발견한 불일치

명세를 고치다 보면 기존 명세와 실제 코드가 다른 것을 발견할 수 있다.
**이번 요청 범위가 아니면 고치지 말고** discrepancies에 적어라. 사람이 판단할 몫이다.

## 출력 형식

작업을 마친 뒤 맨 마지막에 \`\`\`json 블록 하나로 출력한다.

\`\`\`json
{
  "features": ["coupon"],
  "summary": "관리자가 읽을 한 줄 요약 — 무엇이 명세에 추가·변경되는지",
  "discrepancies": ["명세는 A라고 하는데 코드는 B로 동작함 — 이번 범위 밖"]
}
\`\`\``

export async function runSpecDraftJob(db: Db, job: ClaimedJob): Promise<JobOutcome> {
  if (!job.requestId) throw new Error('spec_draft job requires a request_id')

  const [request] = await db
    .select()
    .from(changeRequests)
    .where(eq(changeRequests.id, job.requestId))
  if (!request) throw new Error(`request ${job.requestId} not found`)
  if (request.reqNo === null) throw new Error('확정되지 않은 요청에는 명세 변경안을 만들지 않는다')

  const [project] = await db.select().from(projects).where(eq(projects.id, job.projectId))
  if (!project?.workspacePath) throw new Error(`project ${job.projectId} has no workspace_path`)
  if (!project.hubRepo) throw new Error(`project ${job.projectId} has no hub_repo`)

  const [lastAgent] = await db
    .select({ payload: messages.payload })
    .from(messages)
    .where(and(eq(messages.requestId, request.id), eq(messages.role, 'agent')))
    .orderBy(desc(messages.round))
    .limit(1)

  const intake = lastAgent?.payload as IntakeResult | null
  if (!intake?.summary) throw new Error('확정된 변경 요청서가 없습니다')

  // 견적 단계가 지적한 위험이 곧 미해결 설계 결정이다 — 구현 규칙에 남길 재료다
  const [estimate] = await db
    .select({ wbs: estimates.wbs })
    .from(estimates)
    .where(eq(estimates.requestId, request.id))
    .orderBy(desc(estimates.version))
    .limit(1)
  const estimation = estimate?.wbs as EstimationResult | null

  const cwd = project.workspacePath
  const reqTag = `REQ-${String(request.reqNo).padStart(3, '0')}`
  const branch = specBranch(request.reqNo)

  // 러너가 브랜치를 연다 — 에이전트는 git을 만지지 않는다
  await prepareBranch(cwd, branch)

  const prompt = [
    `확정된 변경 요청서다. 이 내용이 명세에 반영되도록 \`specs/features/\`를 고쳐라.`,
    '',
    `## ${reqTag} — ${intake.summary.title}`,
    '',
    '**이번 변경으로 동작이 이렇게 바뀐다**',
    ...intake.summary.scope.map((s) => `- ${s}`),
    '',
    '**클라이언트 원문**',
    request.asIs ? `지금은: ${request.asIs}` : '',
    `이렇게 되면 좋겠다: ${request.toBe}`,
    '',
    '**앞 단계 탐색 노트 — 이 중 구체적인 규칙은 `## 구현 규칙 (내부)` 에 남긴다**',
    '(클라이언트가 읽는 "이렇게 동작해요"에는 옮기지 않는다)',
    intake.notes,
    estimation?.risks?.length
      ? `\n**견적 단계에서 지적된 위험 — 미해결이면 "(미정)"으로 규칙에 남긴다**\n${estimation.risks.map((r) => `- ${r}`).join('\n')}`
      : '',
    '',
    `추가하는 항목에는 \`(예정 · ${reqTag})\` 태그를 붙인다.`,
  ]
    .filter(Boolean)
    .join('\n')

  let lastText = ''
  const run = await runAgent({
    prompt,
    cwd,
    policy: policyForJob('spec_draft'),
    appendSystemPrompt: SPEC_SYSTEM,
    onEvent: (ev) => {
      const text = statusTextFrom(ev)
      if (text && text !== lastText) {
        lastText = text
        void setStatusText(db, job.id, text).catch(() => {})
      }
    },
  })

  const result = parseSpecDraftResult(run.text)

  if (!(await hasChanges(cwd))) {
    throw new Error('에이전트가 명세를 고치지 않았습니다')
  }

  // specs/ 만 커밋한다 — 에이전트가 다른 걸 건드렸어도 올라가지 않는다
  await commitPaths(
    cwd,
    ['specs'],
    `${reqTag} 명세 변경안\n\n${result.summary}\n\n요청: ${intake.summary.title}`,
  )
  const diff = await diffAgainstMain(cwd)
  const sha = await headSha(cwd)
  await pushBranch(cwd, branch)

  const pr = await createPr(cwd, {
    branch,
    title: `${reqTag} ${intake.summary.title}`,
    body: [
      result.summary,
      '',
      '### 이번 요청으로 바뀌는 동작',
      ...intake.summary.scope.map((s) => `- ${s}`),
      result.discrepancies.length
        ? `\n### 발견한 불일치 (이번 범위 밖)\n${result.discrepancies.map((d) => `- ${d}`).join('\n')}`
        : '',
      '',
      '---',
      '이 PR은 Ticket Tree가 생성했습니다. 머지는 관리자 승인 뒤 러너가 합니다.',
    ]
      .filter(Boolean)
      .join('\n'),
  })

  await db.insert(pullRequests).values({
    requestId: request.id,
    repoId: null, // NULL이면 허브(Spec) PR (§9)
    kind: 'spec',
    prNumber: pr.number,
    status: 'open',
    headSha: sha,
    branch,
    diff,
  })

  for (const feature of result.features) {
    await db.insert(specVersions).values({
      projectId: project.id,
      feature,
      version: 'pending',
      requestId: request.id,
      hubPr: pr.number,
      status: 'proposed',
      summary: result.summary,
    })
  }

  // 브랜치를 남겨두면 다음 job이 엉뚱한 곳에서 시작한다
  await prepareBranch(cwd, 'main').catch(() => {})

  return {
    status: 'done',
    result: { ...result, pr_number: pr.number, branch, url: pr.url } as never,
    tokensIn: run.tokensIn,
    tokensOut: run.tokensOut,
    costUsd: run.costUsd,
    model: run.model,
  }
}
