/**
 * 견적 산출 job — spec.md §2, §8
 *
 * 티켓 확정 직후 돈다. 접수 대화 세션을 상속하지 않고 깨끗하게 시작한다 (§4) —
 * 대화 맥락 대신 확정된 변경 요청서와 탐색 노트만 넘겨받는다.
 */
import { and, desc, eq, sql } from 'drizzle-orm'
import {
  changeRequests,
  estimates,
  jobs,
  messages,
  parseEstimationResult,
  pendingNotices,
  policyForJob,
  projects,
  transition,
  type Db,
  type IntakeResult,
} from '@ticketree/shared'
import { runAgent } from '../agent/claude.js'
import { statusTextFrom } from '../agent/status-text.js'
import { setStatusText, type ClaimedJob, type JobOutcome } from '../queue.js'

const AGENT = { kind: 'agent' as const }

const ESTIMATION_SYSTEM = `당신은 외주 개발팀의 견적 담당이다. 확정된 변경 요청서를 받아 작업을 분해하고 견적을 낸다.

## 규칙

1. **코드를 보고 낸다.** 작업 분해의 각 항목은 실제로 손대야 하는 코드에 근거한다.
2. **검토·검수 시간을 반드시 포함한다.** 에이전트가 구현해도 사람이 읽고 확인하는 시간은 든다.
3. **위험 요소를 숨기지 않는다.** 기존 동작을 깨뜨릴 수 있는 지점, 테스트가 없는 영역, 외부 연동이 필요한 부분은 risks에 적는다.
4. **금액은 원 단위 정수로 낸다.** 만원 단위로 반올림한다.

## 출력 형식

맨 마지막에 아래 스키마의 JSON을 \`\`\`json 블록 하나로 출력한다.

\`\`\`json
{
  "wbs": [{ "task": "작업 한 줄", "hours": 2.5, "repo": "web" }],
  "total_hours": 5.5,
  "review_hours": 1.5,
  "estimated_agent_tokens": 400000,
  "proposed_amount": 520000,
  "estimated_days": "3~4일",
  "rationale": "이 금액이 나온 근거 — 관리자가 읽는다",
  "risks": ["기존 동작을 깨뜨릴 수 있는 지점"]
}
\`\`\``

export async function runEstimationJob(db: Db, job: ClaimedJob): Promise<JobOutcome> {
  if (!job.requestId) throw new Error('estimation job requires a request_id')

  const [request] = await db
    .select()
    .from(changeRequests)
    .where(eq(changeRequests.id, job.requestId))
  if (!request) throw new Error(`request ${job.requestId} not found`)

  const [project] = await db.select().from(projects).where(eq(projects.id, job.projectId))
  if (!project?.workspacePath) throw new Error(`project ${job.projectId} has no workspace_path`)

  // 확정된 변경 요청서 — 접수 대화의 마지막 ready 결과
  const [lastAgent] = await db
    .select({ payload: messages.payload })
    .from(messages)
    .where(and(eq(messages.requestId, request.id), eq(messages.role, 'agent')))
    .orderBy(desc(messages.round))
    .limit(1)

  const intake = lastAgent?.payload as IntakeResult | null
  if (!intake?.summary) throw new Error('확정된 변경 요청서가 없습니다')

  // 유사 규모 과거 건의 실제 원가 — 견적 보정의 근거 (§8)
  const [past] = await db
    .select({
      avgTokens: sql<number>`coalesce(avg(${jobs.tokensIn} + ${jobs.tokensOut}), 0)::bigint`,
      n: sql<number>`count(*)::int`,
    })
    .from(jobs)
    .where(and(eq(jobs.projectId, job.projectId), eq(jobs.kind, 'implementation'), eq(jobs.status, 'done')))

  await transition(db, request.id, 'estimating', AGENT, { jobId: job.id })

  const prompt = [
    '아래 변경 요청서가 확정됐다. 코드를 확인하고 견적을 산출하라.',
    '',
    `## ${intake.summary.title}`,
    '',
    '**포함되는 작업**',
    ...intake.summary.scope.map((s) => `- ${s}`),
    '',
    `**접수 단계 러프 견적**: ${intake.summary.rough_min.toLocaleString()}~${intake.summary.rough_max.toLocaleString()}원 (${intake.summary.estimated_days})`,
    '',
    '**탐색 노트 (앞 단계에서 확인한 내용)**',
    intake.notes,
    '',
    intake.files.length ? `**확인했던 파일**: ${intake.files.join(', ')}` : '',
    past && past.n > 0
      ? `\n참고: 이 프로젝트의 과거 구현 job ${past.n}건 평균 토큰 사용량은 ${Number(past.avgTokens).toLocaleString()}이다.`
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  let lastText = ''
  const run = await runAgent({
    prompt,
    cwd: project.workspacePath,
    policy: policyForJob('estimation'),
    appendSystemPrompt: ESTIMATION_SYSTEM,
    onEvent: (ev) => {
      const text = statusTextFrom(ev)
      if (text && text !== lastText) {
        lastText = text
        void setStatusText(db, job.id, text).catch(() => {})
      }
    },
  })

  const result = parseEstimationResult(run.text)

  // 러프 견적 행에 확정치를 얹는다 — 같은 요청의 견적 이력을 한 줄로 유지한다
  const [existing] = await db
    .select({ id: estimates.id, version: estimates.version })
    .from(estimates)
    .where(eq(estimates.requestId, request.id))
    .orderBy(desc(estimates.version))
    .limit(1)

  if (existing) {
    await db
      .update(estimates)
      .set({
        proposedAmount: result.proposed_amount,
        estimatedDays: result.estimated_days,
        costEstimateTokens: result.estimated_agent_tokens,
        wbs: result as never,
      })
      .where(eq(estimates.id, existing.id))
  } else {
    await db.insert(estimates).values({
      requestId: request.id,
      version: 1,
      proposedAmount: result.proposed_amount,
      estimatedDays: result.estimated_days,
      costEstimateTokens: result.estimated_agent_tokens,
      wbs: result as never,
    })
  }

  await transition(db, request.id, 'quote_ready', AGENT, {
    proposedAmount: result.proposed_amount,
  })
  await db.insert(pendingNotices).values({ requestId: request.id, type: 'quote_ready' })

  return {
    status: 'done',
    result: result as never,
    tokensIn: run.tokensIn,
    tokensOut: run.tokensOut,
    costUsd: run.costUsd,
    model: run.model,
  }
}
