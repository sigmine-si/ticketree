/**
 * 견적 산출 job — spec.md §2, §8
 *
 * 티켓 확정 직후 돈다. 접수 대화 세션을 상속하지 않고 깨끗하게 시작한다 (§4) —
 * 대화 맥락 대신 확정된 변경 요청서와 탐색 노트만 넘겨받는다.
 */
import { and, desc, eq, sql } from 'drizzle-orm'
import {
  changeRequests,
  enqueueJob,
  estimates,
  jobs,
  messages,
  parseEstimationResult,
  pendingNotices,
  policyForJob,
  projects,
  requestTag,
  transition,
  type Db,
  type EstimationResult,
  type IntakeResult,
} from '@ticketree/shared'
import { runAgent } from '../agent/claude.js'
import { createProgressReader, PROGRESS_INSTRUCTION } from '../agent/progress.js'
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

/**
 * 범위 판정 규칙 — 발효 중인 과업내용서가 있을 때만 시스템 프롬프트에 붙는다.
 *
 * 계약이 없는 프로젝트에는 이 블록도 `scope` 출력도 요구하지 않는다.
 * 출력이 안 늘어나므로 기존 프로젝트의 견적 지연도 그대로다(§16-11).
 */
const SCOPE_RULES = `## 범위 판정 (계약이 있는 프로젝트)

이 프로젝트에는 발효 중인 **과업내용서(계약서)**가 있다. 견적을 내기 **전에**,
이번 요청이 그 계약 범위 안인지 밖인지 먼저 판정하라.

이 판정이 금액을 정한다. 계약에 이미 포함된 일을 또 청구하면 계약 위반이고,
계약에 없는 일을 무상으로 하면 회사가 손해를 본다.

### 순서

1. 아래 표에 있는 계약 본문 경로를 **Read로 읽어라.** 반드시 읽는다 — 안 읽고 판정하지 않는다.
2. 작업 분해(wbs)의 **항목마다** 그 계약의 어느 조항에 걸리는지 본다.
   - 과업 범위에 있으면 \`covered: true\`, \`sow_clause\`에 그 조항 제목.
   - **제외 범위에 명시된 것이면 무조건 \`covered: false\`다.** 계약할 때 일부러 뺀 항목이다.
   - 어느 계약에도 없으면 \`covered: false\`.
3. \`proposed_amount\`는 **\`covered: false\`인 항목만의 합**이다. 전부 covered면 0원이다.
4. \`scope\` 블록을 채운다.
   - \`verdict\`: 전부 포함이면 \`included\`, 일부만이면 \`partial\`, 하나도 없으면 \`out_of_scope\`
   - \`covered_amount\`: 포함분을 유료로 쳤다면 얼마였는가 (청구액이 아니다)
   - \`basis\`: 판정의 근거. **\`quote\`는 계약서 원문을 글자 그대로 옮긴다.**
     요약하거나 다듬으면 안 된다 — 나중에 클라이언트가 원문과 대조한다.
   - \`client_note\`: 클라이언트가 그대로 읽을 한 문장. 내부 용어를 쓰지 않는다.

### 주의

- **무상 판정(\`included\`·\`partial\`)에는 반드시 \`basis\`를 채워라.** 근거 없는 무상 판정은 버려진다.
- 애매하면 무상으로 밀지 말고 \`basis\`에 두 조항을 다 적어 관리자가 판단하게 하라.
- 존재하지 않는 문서나 조항을 지어내지 마라. 인용은 실제로 읽은 문장이어야 한다.

### 출력에 더할 것

wbs 항목마다 \`covered\`·\`sow_clause\`를, 최상위에 \`scope\` 블록을 추가한다.

\`\`\`json
{
  "wbs": [
    { "task": "로그인 화면 문구 수정", "hours": 1, "repo": "web", "covered": true, "sow_clause": "로그인 기능" },
    { "task": "카카오 로그인 연동", "hours": 6, "repo": "web", "covered": false, "sow_clause": "" }
  ],
  "proposed_amount": 480000,
  "scope": {
    "verdict": "partial",
    "client_note": "로그인 화면 수정은 계약에 포함되어 있어 추가 비용이 없어요. 카카오 로그인 연동만 새 작업이라 별도 비용이 들어요.",
    "admin_note": "제외 범위에 소셜 로그인이 명시돼 있어 연동분만 청구",
    "covered_amount": 80000,
    "basis": [
      {
        "sow": "SOW-001 1차 구축",
        "file": "specs/contracts/SOW-001.md",
        "clause": "과업 범위 — 로그인",
        "quote": "이메일·비밀번호 로그인과 비밀번호 재설정을 제공한다.",
        "reason": "in_scope",
        "covers": ["로그인 화면 문구 수정"]
      },
      {
        "sow": "SOW-001 1차 구축",
        "file": "specs/contracts/SOW-001.md",
        "clause": "제외 범위",
        "quote": "소셜 로그인(카카오·구글)은 이번 범위에 포함하지 않는다.",
        "reason": "excluded",
        "covers": ["카카오 로그인 연동"]
      }
    ]
  }
}
\`\`\``

const OUTPUT_TAIL = `${PROGRESS_INSTRUCTION}`

/**
 * 러너의 사후 검증 — 에이전트가 낸 판정을 그대로 믿지 않는다.
 *
 * zod에서 하드 실패시키지 않는다. 규칙 위반으로 job 전체를 죽일 이유는 없다 —
 * 대신 신뢰할 수 없는 판정을 유료 견적으로 떨어뜨리고 관리자에게 넘긴다.
 */
function reconcileScope(
  result: EstimationResult,
  sowRefs: Array<{ file: string }>,
): EstimationResult {
  const scope = result.scope
  if (!scope) return result

  // 실재하지 않는 문서를 인용한 근거는 버린다. 분쟁에서 최악인 종류의 근거다.
  const files = new Set(sowRefs.map((s) => s.file))
  const basis = scope.basis.filter((b) => !b.file || files.has(b.file))

  // 항목이 판정을 이긴다 — 금액의 근거는 라벨이 아니라 항목이다
  const coveredCount = result.wbs.filter((w) => w.covered).length
  const verdict =
    coveredCount === result.wbs.length
      ? 'included'
      : coveredCount === 0
        ? 'out_of_scope'
        : 'partial'

  // **무상 판정에만 근거를 요구한다.** 비대칭이지만 옳다 — 회사가 손해 보는
  // 방향의 판정에만 증거를 요구한다. 유료 판정에 근거가 없으면 그냥 평소 견적이다.
  if ((verdict === 'included' || verdict === 'partial') && basis.length === 0) {
    return {
      ...result,
      wbs: result.wbs.map((w) => ({ ...w, covered: false, sow_clause: '' })),
      scope: undefined,
    }
  }

  return {
    ...result,
    // 전부 계약 범위면 청구액은 0이다. 에이전트가 뭘 냈든 덮는다.
    proposed_amount: verdict === 'included' ? 0 : result.proposed_amount,
    scope: {
      ...scope,
      verdict,
      basis,
      covered_amount: verdict === 'out_of_scope' ? 0 : scope.covered_amount,
    },
  }
}

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

  // 발효 중인 계약. 러너가 목록을 뽑아 경로를 주고, 본문은 에이전트가 직접 읽는다 —
  // 프롬프트에 본문을 실으면 인용이 원문에서 왔는지 러너가 자른 조각에서 왔는지
  // 흐려지는데, 원문 대조 가능성이 이 판정의 값 전체다.
  //
  // 에이전트가 스스로 Glob하게 두지도 않는다. 못 찾으면 조용히 판정을 건너뛰어
  // 무상이어야 할 건에 청구서가 나간다.
  const activeSows = await db
    .select({ reqNo: changeRequests.reqNo, title: changeRequests.title, id: changeRequests.id })
    .from(changeRequests)
    .where(
      and(
        eq(changeRequests.projectId, job.projectId),
        eq(changeRequests.kind, 'sow'),
        eq(changeRequests.status, 'sow_active'),
      ),
    )
    .orderBy(changeRequests.reqNo)

  const sowRefs = activeSows.map((s) => ({
    id: s.id,
    tag: requestTag('sow', s.reqNo),
    title: s.title ?? '과업내용서',
    file: `specs/contracts/${requestTag('sow', s.reqNo)}.md`,
  }))

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
    sowRefs.length
      ? [
          '',
          '## 이 프로젝트의 과업내용서 (발효 중)',
          '',
          '| 계약 | 본문 경로 |',
          '|---|---|',
          ...sowRefs.map((s) => `| ${s.tag} ${s.title} | ${s.file} |`),
          '',
          '**위 경로를 Read로 읽고**, 이번 요청의 각 작업 항목이 어느 조항에 걸리는지 판정하라.',
          '판정을 먼저 하고 금액을 낸다.',
        ].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  let lastText = ''
  const progress = createProgressReader()
  const show = (text: string) => {
    if (!text || text === lastText) return
    lastText = text
    void setStatusText(db, job.id, text).catch(() => {})
  }

  const run = await runAgent({
    prompt,
    cwd: project.workspacePath,
    policy: policyForJob('estimation'),
    // 계약이 없으면 판정 블록도 scope 출력도 요구하지 않는다 — 출력이 안 늘어
    // 기존 프로젝트의 견적 지연이 그대로다
    appendSystemPrompt: [ESTIMATION_SYSTEM, sowRefs.length ? SCOPE_RULES : '', OUTPUT_TAIL]
      .filter(Boolean)
      .join('\n\n'),
    // 접수 대화와 같다 — 에이전트가 남긴 진행 문구가 고정 문구를 이긴다
    onTextDelta: (chunk) => {
      for (const line of progress.push(chunk)) show(line)
    },
    onEvent: (ev) => {
      if (lastText) return
      show(statusTextFrom(ev) ?? '')
    },
  })

  const result = reconcileScope(parseEstimationResult(run.text), sowRefs)
  const verdict = result.scope?.verdict ?? null
  const basisSowId =
    sowRefs.find((s) => s.file === result.scope?.basis[0]?.file)?.id ??
    (sowRefs.length === 1 ? sowRefs[0]!.id : null)

  // 러프 견적 행에 확정치를 얹는다 — 같은 요청의 견적 이력을 한 줄로 유지한다
  const [existing] = await db
    .select({ id: estimates.id, version: estimates.version })
    .from(estimates)
    .where(eq(estimates.requestId, request.id))
    .orderBy(desc(estimates.version))
    .limit(1)

  // 판정은 견적과 한 몸으로 읽히므로 같은 행에 얹는다. 근거 본문은 wbs jsonb에
  // 통째로 실리지만, 목록·큐에서 뱃지를 그리려면 컬럼이어야 한다.
  const scopeFields = {
    scopeVerdict: verdict,
    sowId: verdict ? basisSowId : null,
    scopeBasis: (result.scope?.basis ?? []) as never,
    coveredAmount: result.scope?.covered_amount ?? null,
    scopeClientNote: result.scope?.client_note ?? null,
  }

  if (existing) {
    await db
      .update(estimates)
      .set({
        proposedAmount: result.proposed_amount,
        estimatedDays: result.estimated_days,
        costEstimateTokens: result.estimated_agent_tokens,
        wbs: result as never,
        ...scopeFields,
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
      ...scopeFields,
    })
  }

  // 명세 변경안은 클라이언트의 견적 승인과 병렬로 만든다.
  // 관리자가 검토할 때는 이미 PR이 있어야 하므로 여기서 미리 건다 (§2).
  await enqueueJob(db, {
    projectId: job.projectId,
    requestId: request.id,
    kind: 'spec_draft',
  })

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
