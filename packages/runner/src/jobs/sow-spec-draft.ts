/**
 * 과업내용서 → 첫 명세 job
 *
 * 확정된 과업내용서를 고객 저장소의 명세로 옮기고 PR을 연다.
 * 머지되면 계약이 발효되고, 거기서 과업내용서의 책임은 끝난다 —
 * 구현은 그 뒤 요청(티켓)이 한다.
 *
 * `spec-draft.ts`와 하는 일이 다르다. 저쪽은 *이미 있는 명세를 고치고*,
 * 여기는 *아직 없는 명세를 세운다*. 그래서 항목이 전부 `- [ ]`다.
 * `onboarding.ts`와도 다르다. 저쪽은 *이미 동작하는 코드에서 사실을 읽어* 적고(`- [x]`),
 * 여기는 *아직 없는 것을 계약에서 옮겨* 약속으로 적는다.
 *
 * 계약 원문(`specs/contracts/`)은 **러너가 직접 쓴다.** 에이전트에게 옮겨 적게 하면
 * 요약하거나 말을 바꾸는데, 범위 판정이 이 문장들을 그대로 인용하기 때문이다.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { and, desc, eq } from 'drizzle-orm'
import {
  changeRequests,
  messages,
  parseSpecDraftResult,
  policyForJob,
  projects,
  pullRequests,
  requestTag,
  specVersions,
  transition,
  type Db,
  type SowDoc,
  type SowResult,
} from '@ticketree/shared'
import { runAgent } from '../agent/claude.js'
import { statusTextFrom } from '../agent/status-text.js'
import { setStatusText, type ClaimedJob, type JobOutcome } from '../queue.js'
import {
  closePr,
  commitPaths,
  createPr,
  diffAgainstMain,
  ensureClone,
  hasChanges,
  headSha,
  prepareBranch,
  pushBranch,
  sowBranch,
} from '../git.js'
import { hasSpecFiles } from './sow.js'
import { SPEC_FILE_FORMAT, SPEC_LAYERS } from './spec-format.js'

const AGENT = { kind: 'agent' as const }

const SOW_SPEC_SYSTEM = `당신은 외주 개발팀의 명세 담당이다. 클라이언트와 합의된 **과업내용서**를 받아 프로젝트 명세를 세운다.

## 지금 하는 일이 무엇인가

과업내용서는 계약서다. 거기 적힌 것이 우리가 만들기로 약속한 전부다.
당신의 일은 그 약속을 **명세의 언어로 옮기는 것**이지, 약속을 늘리거나 해석해서 채우는 것이 아니다.

**아직 아무것도 만들어지지 않았다.** 그래서 모든 항목은 완료가 아니라 예정이다.

${SPEC_LAYERS}

## 명세 형식

${SPEC_FILE_FORMAT}

## 과업내용서를 옮길 때의 규칙

1. **모든 동작 항목은 \`- [ ] (예정 · {SOW태그})\` 형식이다.** 아직 만들어지지 않았으므로
   \`- [x]\`를 쓰지 않는다. 예: \`- [ ] (예정 · SOW-001) 구매자가 상품을 주문하면 결제가 진행된다\`
2. **첫 버전은 v0.1이다.** 배포된 적이 없는 명세이므로 v1.0이 아니다.
   변경 이력은 \`- v0.1 <오늘 날짜> ({SOW태그}) 과업내용서에서 최초 정의\`.
3. **과업 범위에 있는 것만 적는다.** 계약에 없는 기능을 "당연히 필요하니까" 넣지 않는다.
   그 순간 우리가 공짜로 만들기로 약속한 것이 된다.
4. **제외 범위는 각 기능 명세의 \`## 알려진 제약\`에 적는다.**
   계약에서 명시적으로 뺀 것이므로 클라이언트 화면에 보여야 한다.
   예: \`- 소셜 로그인(카카오·구글)은 이번 범위에 포함되지 않는다\`
5. **비기능 요구사항은 \`specs/overview.md\`에 "지켜야 할 수준"으로 모은다.**
   응답 속도·동시 접속자·지원 브라우저 같은 것은 어느 기능도 혼자 소유하지 않는다.
6. **검수 기준과 일정, 산출물 목록은 명세에 옮기지 않는다.**
   그건 계약 문서의 몫이고 이미 \`specs/contracts/\`에 원문이 있다.
   명세는 "무엇이 어떻게 동작하는가"만 담는다.
7. 아직 안 정해진 구현 세부는 \`## 구현 규칙 (내부)\`에 \`(미정)\`으로 남긴다.
   계약 단계에서는 정해지지 않은 것이 많은 게 정상이다. 지어내지 마라.

## 하지 말아야 할 일

- **git 명령을 실행하지 않는다.** 브랜치·커밋·PR은 러너가 한다. 파일만 고치면 된다.
- \`specs/\` 밖의 파일을 고치지 않는다. 코드는 이번 job의 대상이 아니다.
- **\`specs/contracts/\` 아래 파일을 고치지 않는다.** 계약 원문이라 손대면 안 된다.
- 과업내용서에 없는 기능을 명세에 넣지 않는다.

## 출력 형식

작업을 마친 뒤 맨 마지막에 \`\`\`json 블록 하나로 출력한다.

\`\`\`json
{
  "features": ["order", "settlement"],
  "summary": "관리자가 읽을 한 줄 요약",
  "discrepancies": ["계약에 적혀 있으나 명세로 옮기기 애매한 것 — 사람이 판단할 몫"]
}
\`\`\``

/** 과업내용서 여덟 항목을 마크다운으로. 프롬프트와 계약 파일이 같은 렌더를 쓴다. */
function renderSow(sow: SowDoc): string {
  const list = (xs: string[]) => xs.map((x) => `- ${x}`).join('\n')
  return [
    `## 과업 개요\n\n${sow.overview}`,
    `## 과업 범위\n\n${list(sow.scope)}`,
    `## 제외 범위\n\n이번 계약에 **포함되지 않는** 것이다.\n\n${list(sow.out_of_scope)}`,
    `## 요구사항\n\n${list(sow.requirements)}`,
    `## 산출물\n\n${list(sow.deliverables)}`,
    `## 일정과 마일스톤\n\n${sow.milestones.map((m) => `- ${m.name} — ${m.due}`).join('\n')}`,
    sow.provided.length ? `## 개발 환경과 제공사항\n\n${list(sow.provided)}` : '',
    `## 검수 기준과 절차\n\n${list(sow.acceptance)}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

export async function runSowSpecDraftJob(db: Db, job: ClaimedJob): Promise<JobOutcome> {
  if (!job.requestId) throw new Error('sow_spec_draft job requires a request_id')

  const [request] = await db
    .select()
    .from(changeRequests)
    .where(eq(changeRequests.id, job.requestId))
  if (!request) throw new Error(`request ${job.requestId} not found`)
  if (request.kind !== 'sow') throw new Error('과업내용서가 아닌 요청입니다')
  if (request.reqNo === null) throw new Error('확정되지 않은 과업내용서입니다')

  const [project] = await db.select().from(projects).where(eq(projects.id, job.projectId))
  if (!project?.workspacePath) throw new Error(`project ${job.projectId} has no workspace_path`)
  if (!project.hubRepo) throw new Error(`project ${job.projectId} has no hub_repo`)

  const [lastAgent] = await db
    .select({ payload: messages.payload })
    .from(messages)
    .where(and(eq(messages.requestId, request.id), eq(messages.role, 'agent')))
    .orderBy(desc(messages.round))
    .limit(1)

  const sow = (lastAgent?.payload as SowResult | null)?.sow
  if (!sow) throw new Error('확정된 과업내용서가 없습니다')

  const cwd = project.workspacePath
  const sowTag = requestTag('sow', request.reqNo)
  const branch = sowBranch(request.reqNo)

  // 첫 계약이면 저장소가 아직 없을 수 있다 — 온보딩과 같은 이유로 여기서 만든다
  await ensureClone(project.hubRepo, cwd)

  // 재실행이면 앞서 연 PR을 먼저 닫는다. 같은 브랜치에 다시 push하면
  // GitHub이 옛 PR을 되살려 리뷰 맥락이 섞인다.
  const [stale] = await db
    .select({ id: pullRequests.id, prNumber: pullRequests.prNumber })
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.requestId, request.id),
        eq(pullRequests.kind, 'sow_spec'),
        eq(pullRequests.status, 'open'),
      ),
    )
  if (stale) {
    await closePr(cwd, stale.prNumber, '과업내용서 명세를 다시 씁니다.')
    await db.update(pullRequests).set({ status: 'closed' }).where(eq(pullRequests.id, stale.id))
    await db
      .update(specVersions)
      .set({ status: 'superseded' })
      .where(and(eq(specVersions.requestId, request.id), eq(specVersions.status, 'proposed')))
  }

  await prepareBranch(cwd, branch)

  // 맨바닥 계약인지 추가 계약인지는 **러너가 판정한다.**
  // 에이전트에게 맡기면 못 찾았을 때 조용히 넘어가, 2차 계약이 1차에서 이미
  // 약속한 것을 범위에 다시 넣는다 — 계약비를 두 번 받게 된다.
  const isExtend = hasSpecFiles(cwd)

  // 계약 원문을 러너가 직접 쓴다. 에이전트가 옮겨 적으면 말이 바뀌는데,
  // 범위 판정이 이 문장을 그대로 인용하므로 원문이어야 한다.
  const contractPath = join(cwd, 'specs', 'contracts', `${sowTag}.md`)
  mkdirSync(dirname(contractPath), { recursive: true })
  writeFileSync(
    contractPath,
    [
      `# ${sowTag} — ${request.title ?? '과업내용서'}`,
      '',
      `확정일: ${new Date().toISOString().slice(0, 10)}`,
      '',
      '> 클라이언트와 합의한 과업내용서 원문이다. 고치지 않는다 —',
      '> 이후 들어오는 요청이 이 계약 범위 안인지 밖인지를 이 문장들로 판단한다.',
      '',
      renderSow(sow),
      '',
    ].join('\n'),
    'utf8',
  )

  const prompt = [
    isExtend
      ? `${sowTag} 과업내용서가 확정됐다. **이 저장소에는 이미 명세가 있다.** 먼저 \`specs/\`를 전부 읽고, 이번 계약으로 새로 생기는 것만 명세에 반영하라.`
      : `${sowTag} 과업내용서가 확정됐다. **이 저장소에는 아직 명세가 없다.** 명세 세 층을 처음부터 세워라.`,
    '',
    `계약 원문은 \`specs/contracts/${sowTag}.md\`에 이미 저장돼 있다. 아래와 같은 내용이다.`,
    '',
    '---',
    '',
    renderSow(sow),
    '',
    '---',
    '',
    isExtend
      ? [
          '**이미 명세에 있는 것을 이번 범위로 다시 적지 마라.**',
          '1차 계약에서 약속한 것을 2차 명세에 또 넣으면 같은 일을 두 번 계약한 것이 된다.',
          '겹치는 항목을 발견하면 그 줄은 건드리지 말고 discrepancies에 "이미 약속됨"으로 적어라.',
        ].join('\n')
      : [
          '읽을 코드가 없다. 계약서만 보고 명세를 세운다.',
          '기능을 어떻게 쪼갤지는 과업 범위의 항목들을 보고 정하라.',
        ].join('\n'),
    '',
    `추가하는 모든 동작 항목에 \`(예정 · ${sowTag})\` 태그를 붙인다.`,
  ].join('\n')

  let lastText = ''
  const run = await runAgent({
    prompt,
    cwd,
    policy: policyForJob('sow_spec_draft'),
    appendSystemPrompt: SOW_SPEC_SYSTEM,
    onEvent: (ev) => {
      const text = statusTextFrom(ev)
      if (text && text !== lastText) {
        lastText = text
        void setStatusText(db, job.id, text).catch(() => {})
      }
    },
  })

  const result = parseSpecDraftResult(run.text)

  // 계약 원문을 러너가 이미 썼으므로 변경이 아예 없을 수는 없다.
  // 그래도 확인한다 — 에이전트가 명세를 안 만들었으면 계약 파일만 덩그러니 남는다.
  if (!(await hasChanges(cwd))) {
    throw new Error('에이전트가 명세를 만들지 않았습니다')
  }

  await commitPaths(
    cwd,
    ['specs'],
    `${sowTag} 과업내용서 명세\n\n${result.summary}`,
  )
  const diff = await diffAgainstMain(cwd, 'specs')
  const sha = await headSha(cwd)
  await pushBranch(cwd, branch)

  const pr = await createPr(cwd, {
    branch,
    title: `${sowTag} ${request.title ?? '과업내용서'}`,
    body: [
      result.summary,
      '',
      '### 이번 계약의 범위',
      ...sow.scope.map((s) => `- ${s}`),
      '',
      '### 제외 범위 (포함되지 않는 것)',
      ...sow.out_of_scope.map((s) => `- ${s}`),
      result.discrepancies.length
        ? `\n### 사람이 판단할 것\n${result.discrepancies.map((d) => `- ${d}`).join('\n')}`
        : '',
      '',
      '---',
      `계약 원문은 \`specs/contracts/${sowTag}.md\`에 있습니다.`,
      '**머지하면 이 계약이 발효됩니다** — 이후 들어오는 요청은 이 범위와 대조되어',
      '범위 안이면 추가 비용 없이, 범위 밖이면 별도 견적으로 처리됩니다.',
      '읽고 고친 뒤 승인하세요.',
    ]
      .filter(Boolean)
      .join('\n'),
  })

  await db.insert(pullRequests).values({
    requestId: request.id,
    repoId: null,
    kind: 'sow_spec',
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

  await prepareBranch(cwd, 'main').catch(() => {})

  // 관리자 Spec 승인 대기로 넘긴다. client_approved라는 이름은 어색하지만
  // decisionOf가 이 상태를 'Spec 승인'으로 정의하고 있어 관리자 큐가 그대로 동작한다.
  await transition(db, request.id, 'client_approved', AGENT, { specPr: pr.number })

  return {
    status: 'done',
    result: { ...result, pr_number: pr.number, branch, url: pr.url } as never,
    tokensIn: run.tokensIn,
    tokensOut: run.tokensOut,
    costUsd: run.costUsd,
    model: run.model,
  }
}
