/**
 * 에이전트 입출력 계약 — spec.md §4
 *
 * 대화 레인은 read-only라 파일로 결과를 쓸 수 없다. 따라서 구조화된 결과는
 * 최종 응답 안의 ```json 블록으로 받는다. 이 파일이 그 계약의 유일한 정의다.
 */
import { z } from 'zod'

/** 제목은 목록에 그대로 걸리므로 길이를 여기서 자른다. */
const clipTitle = (s: string) => (s.length > 40 ? `${s.slice(0, 39)}…` : s)

export const questionSchema = z.object({
  prompt: z.string().min(1),
  hint: z.string().optional(),
  kind: z.enum(['choice', 'free', 'choice_or_free']).default('choice_or_free'),
  options: z.array(z.string()).default([]),
})
export type AgentQuestion = z.infer<typeof questionSchema>

export const changeSummarySchema = z.object({
  title: z.string().min(1),
  scope: z.array(z.string()).min(1),
  rough_min: z.number().int().nonnegative(),
  rough_max: z.number().int().nonnegative(),
  estimated_days: z.string(),
})
export type ChangeSummary = z.infer<typeof changeSummarySchema>

export const intakeResultSchema = z.object({
  /**
   * questions — 아직 확정 불가, 확인 질문을 보낸다
   * ready     — 변경 요청서가 확정 가능, 요약과 러프 견적을 제시한다
   * escalate  — Spec 충돌·모호함. 사람의 해석이 필요해 멈춘다 (§5)
   */
  outcome: z.enum(['questions', 'ready', 'escalate']),
  /**
   * 요청 제목 — 매 라운드 갱신한다. 제목 생성을 위한 별도 LLM 호출을 없앤다 (§4).
   * 클라이언트 목록에 그대로 노출되므로 클라이언트의 언어로 쓴다.
   */
  title: z.string().min(1).transform(clipTitle),
  /** 관리자용 탐색 노트. 기술 세부사항은 Spec이 아니라 여기 둔다 (§1) */
  notes: z.string(),
  /** 클라이언트에게 그대로 보여줄 문장 */
  message: z.string(),
  /** 확인한 파일 경로 — 검토 화면의 파일 태그 */
  files: z.array(z.string()).default([]),
  /** 남은 미확정 항목. 진행감을 주기 위해 매 라운드 알린다 (§4-3) */
  remaining: z.array(z.string()).default([]),
  /**
   * 한 라운드 3개 상한은 프롬프트의 규칙이다. 파싱에서 하드 실패시키지 않고
   * 잘라낸다 — 규칙 위반으로 job 전체를 죽일 이유는 없다.
   */
  questions: z
    .array(questionSchema)
    .default([])
    .transform((qs) => qs.slice(0, 3)),
  /**
   * outcome이 questions일 때 에이전트가 summary를 빈 객체로 채워 보내는 일이 잦다.
   * 실질 내용이 없으면 없는 것으로 취급한다.
   */
  summary: z.preprocess(
    (v) => (v && typeof v === 'object' && 'title' in v && (v as { title?: unknown }).title ? v : undefined),
    changeSummarySchema.optional(),
  ),
  escalation: z.string().optional(),
})
export type IntakeResult = z.infer<typeof intakeResultSchema>

/**
 * 최종 텍스트에서 마지막 ```json 블록을 꺼내 파싱한다.
 * 여러 개면 마지막 것 — 에이전트가 설명 중에 예시 JSON을 보일 수 있기 때문이다.
 */
export function extractJsonBlock(text: string): unknown {
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)]
  const raw = fences.length > 0 ? fences[fences.length - 1]![1]! : text
  return JSON.parse(raw.trim())
}

export function parseIntakeResult(text: string): IntakeResult {
  return intakeResultSchema.parse(extractJsonBlock(text))
}

/**
 * 과업내용서 본문 — 계약이 담아야 할 여덟 항목.
 *
 * 전부 `string[]`인 것이 의도다. 항목마다 객체를 주면 출력 토큰이 몇 배가 되고
 * 그만큼 그대로 느려진다(§16-11 — 지연은 탐색이 아니라 **생성**이 지배한다).
 * 중첩이 필요한 건 마일스톤 하나뿐이다. 이름과 기한을 화면에서 갈라 그려야 한다.
 */
export const sowDocSchema = z.object({
  /** 과업 개요 — 무엇을 왜 만드는가, 배경 */
  overview: z.string(),
  /** 과업 범위 — 이번 계약으로 만드는 것 */
  scope: z.array(z.string()).min(1),
  /**
   * 제외 범위. **비면 파싱이 실패한다.**
   * 에이전트가 가장 잘 건너뛰는 항목이면서, 이후 범위 판정 전체가 딛고 서는 항목이다.
   * "이것도 해주는 줄 알았다"를 막는 것이 이 계약서의 목적이므로 여기서 물러서지 않는다.
   */
  out_of_scope: z.array(z.string()).min(1),
  /** 기능·비기능 요구사항. 줄머리에 [기능]/[비기능]을 붙인다. */
  requirements: z.array(z.string()).min(1),
  /** 산출물 목록 — 무엇을 어떤 형태로 넘기는가 */
  deliverables: z.array(z.string()).min(1),
  /** 일정과 마일스톤 */
  milestones: z.array(z.object({ name: z.string(), due: z.string() })).min(1),
  /** 개발 환경과 발주자가 제공해야 할 것(계정·자료·API 키 등) */
  provided: z.array(z.string()).default([]),
  /** 검수 기준과 절차 — "만족스러울 때까지"가 아니라 확인 가능한 형태로 */
  acceptance: z.array(z.string()).min(1),
})
export type SowDoc = z.infer<typeof sowDocSchema>

/**
 * 과업내용서 대화의 결과 — 접수 대화와 같은 모양이되 더 가볍다.
 *
 * `notes`·`files`가 없다. 제로 상태에서는 읽을 코드가 없기 때문이다.
 * `questions`는 접수와 **같은 스키마를 재사용**한다 — message_questions 테이블과
 * 문답 칩 UI가 그 모양에 묶여 있어, 다른 모양을 쓰면 화면을 재사용할 수 없다.
 */
export const sowResultSchema = z.object({
  outcome: z.enum(['questions', 'ready', 'escalate']),
  title: z.string().min(1).transform(clipTitle),
  /** 클라이언트에게 그대로 보여줄 문장 */
  message: z.string(),
  /** 아직 못 정한 항목. 이게 비지 않으면 ready를 쓸 수 없다(프롬프트 규칙). */
  remaining: z.array(z.string()).default([]),
  questions: z
    .array(questionSchema)
    .default([])
    .transform((qs) => qs.slice(0, 3)),
  /** questions 라운드에서 빈 껍데기를 보내는 일이 잦다 — 실질 내용이 없으면 없는 것으로 본다 */
  sow: z.preprocess((v) => {
    if (!v || typeof v !== 'object') return undefined
    const scope = (v as { scope?: unknown }).scope
    return Array.isArray(scope) && scope.length > 0 ? v : undefined
  }, sowDocSchema.optional()),
  escalation: z.string().optional(),
})
export type SowResult = z.infer<typeof sowResultSchema>

export function parseSowResult(text: string): SowResult {
  return sowResultSchema.parse(extractJsonBlock(text))
}

/**
 * 견적 산출 job의 결과 — §8
 *
 * 러프 견적(접수 대화)과 달리 작업 분해와 근거가 붙는다.
 * 관리자가 이걸 보고 청구 금액을 조정해 확정한다.
 */
export const SCOPE_VERDICTS = ['included', 'partial', 'out_of_scope'] as const
export type ScopeVerdict = (typeof SCOPE_VERDICTS)[number]

/**
 * 판정의 근거 한 줄 — 과업내용서의 어느 조항이 이 판단을 만들었는가.
 *
 * 이 기능의 값 전체가 `quote`에 걸려 있다. 요약된 인용은 분쟁에서 쓸 수 없으므로
 * **원문을 글자 그대로** 옮긴다.
 */
export const scopeBasisSchema = z.object({
  /** 근거가 된 과업내용서 — 'SOW-001 1차 구축' */
  sow: z.string(),
  /** 워크스페이스 기준 상대경로. 실재하지 않는 문서를 인용한 근거는 러너가 버린다. */
  file: z.string().default(''),
  /** 그 문서 안의 조항·항목 제목 */
  clause: z.string().default(''),
  /** 원문 인용. 요약하지 않는다. */
  quote: z.string(),
  /**
   * in_scope    — 과업 범위에 있다
   * excluded    — 제외 범위에 명시적으로 걸린다
   * not_covered — 어느 계약에도 없다
   */
  reason: z.enum(['in_scope', 'excluded', 'not_covered']),
  /** 이 근거가 커버하는 wbs 항목의 task 문자열 */
  covers: z.array(z.string()).default([]),
})
export type ScopeBasis = z.infer<typeof scopeBasisSchema>

export const scopeJudgementSchema = z.object({
  verdict: z.enum(SCOPE_VERDICTS),
  /** 클라이언트에게 그대로 나가는 문장. 내부 용어를 쓰지 않는다. */
  client_note: z.string(),
  /** 관리자용 — 왜 그렇게 갈랐는지 */
  admin_note: z.string().default(''),
  /** 포함분을 유료로 쳤다면 얼마였는가(원). **청구액이 아니다.** */
  covered_amount: z.number().int().nonnegative().default(0),
  /** 출력 길이 예산 — questions와 같은 태도로 자른다 */
  basis: z
    .array(scopeBasisSchema)
    .default([])
    .transform((b) => b.slice(0, 5)),
})
export type ScopeJudgement = z.infer<typeof scopeJudgementSchema>

export const estimationResultSchema = z.object({
  wbs: z
    .array(
      z.object({
        task: z.string(),
        hours: z.number().nonnegative(),
        repo: z.string().optional(),
        /** 과업내용서 범위에 이미 포함된 작업인가 — 청구액은 false인 항목의 합이다 */
        covered: z.boolean().default(false),
        /** 이 항목을 커버하는 조항 제목. 없으면 빈 문자열 */
        sow_clause: z.string().default(''),
      }),
    )
    .min(1),
  /** 구현 작업 시간 합계 */
  total_hours: z.number().nonnegative(),
  /** 사람이 검토·검수하는 시간 — 견적에 포함된다 */
  review_hours: z.number().nonnegative(),
  /** 구현 job이 쓸 것으로 예상하는 토큰 */
  estimated_agent_tokens: z.number().int().nonnegative(),
  /**
   * AI 제안가 (원) — **언제나 실제 청구액이다.**
   * 범위 판정이 붙으면 included는 0, partial은 미포함분 합계, out_of_scope는 전체다.
   * 관리자가 조정할 수 있다.
   */
  proposed_amount: z.number().int().nonnegative(),
  estimated_days: z.string(),
  /** 관리자용 산출 근거 */
  rationale: z.string(),
  risks: z.array(z.string()).default([]),
  /**
   * 범위 판정. **optional인 것이 중요하다** — 과업내용서가 없는 프로젝트는 이 블록
   * 자체를 요구하지 않으므로 출력 길이도 지연도 그대로다.
   */
  scope: scopeJudgementSchema.optional(),
})
export type EstimationResult = z.infer<typeof estimationResultSchema>

export function parseEstimationResult(text: string): EstimationResult {
  return estimationResultSchema.parse(extractJsonBlock(text))
}

/**
 * 명세 변경안 job의 결과 — §2, §6
 *
 * 에이전트는 허브 repo에 브랜치를 만들고 명세를 고친 뒤 PR까지 연다.
 * 머지는 하지 않는다 — 그건 관리자 승인 뒤 러너의 일이다 (§1).
 */
export const specDraftResultSchema = z.object({
  // pr_number·branch는 여기 없다 — 러너가 아는 값이라 에이전트에게 묻지 않는다.
  /** 변경한 기능 명세 (파일명 기준: coupon, order …) */
  features: z.array(z.string()).default([]),
  /** 관리자가 읽을 한 줄 요약 */
  summary: z.string(),
  /**
   * 명세를 고치다 발견한 코드-명세 불일치.
   * 이번 요청 범위 밖이라도 여기 적어 사람에게 넘긴다.
   */
  discrepancies: z.array(z.string()).default([]),
})
export type SpecDraftResult = z.infer<typeof specDraftResultSchema>

export function parseSpecDraftResult(text: string): SpecDraftResult {
  return specDraftResultSchema.parse(extractJsonBlock(text))
}

/**
 * 구현 job의 결과 — §2, §6
 *
 * 에이전트는 코드를 고치고 테스트를 돌린다. 커밋·PR은 러너가 한다 (§1).
 */
export const implementationResultSchema = z.object({
  /** 무엇을 어떻게 구현했는지 — 관리자가 읽을 요약 */
  summary: z.string(),
  /** 손댄 파일 경로 */
  changed_files: z.array(z.string()).default([]),
  /**
   * 검증 상태.
   *  passed  — 테스트를 돌렸고 통과했다
   *  none    — 돌릴 테스트가 없었다
   *  failed  — 테스트가 있는데 실패했다(이 경우 원인을 notes에)
   */
  tests: z.enum(['passed', 'none', 'failed']).default('none'),
  /** 미리보기로 확인해야 할 지점 등 관리자용 메모 */
  notes: z.string().default(''),
  /** 구현 중 부딪힌, 명세로는 판단할 수 없는 문제 (있으면 에스컬레이션) */
  blocker: z.string().nullable().default(null),
})
export type ImplementationResult = z.infer<typeof implementationResultSchema>

/** 온보딩 결과 — 요청이 아니라 프로젝트를 세우는 job이라 계약이 따로다 (§12). */
export const onboardingResultSchema = z.object({
  /** 정리한 기능 명세 파일들 (확장자 없이) */
  features: z.array(z.string()).default([]),
  summary: z.string().default(''),
  /** 코드만 봐서는 알 수 없어 사람 확인이 필요한 것 */
  unknowns: z.array(z.string()).default([]),
})
export type OnboardingResult = z.infer<typeof onboardingResultSchema>

export function parseOnboardingResult(text: string): OnboardingResult {
  return onboardingResultSchema.parse(extractJsonBlock(text))
}

export function parseImplementationResult(text: string): ImplementationResult {
  return implementationResultSchema.parse(extractJsonBlock(text))
}
