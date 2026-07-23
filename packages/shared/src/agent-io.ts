/**
 * 에이전트 입출력 계약 — spec.md §4
 *
 * 대화 레인은 read-only라 파일로 결과를 쓸 수 없다. 따라서 구조화된 결과는
 * 최종 응답 안의 ```json 블록으로 받는다. 이 파일이 그 계약의 유일한 정의다.
 */
import { z } from 'zod'

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
  title: z
    .string()
    .min(1)
    .transform((s) => (s.length > 40 ? `${s.slice(0, 39)}…` : s)),
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
 * 견적 산출 job의 결과 — §8
 *
 * 러프 견적(접수 대화)과 달리 작업 분해와 근거가 붙는다.
 * 관리자가 이걸 보고 청구 금액을 조정해 확정한다.
 */
export const estimationResultSchema = z.object({
  wbs: z
    .array(
      z.object({
        task: z.string(),
        hours: z.number().nonnegative(),
        repo: z.string().optional(),
      }),
    )
    .min(1),
  /** 구현 작업 시간 합계 */
  total_hours: z.number().nonnegative(),
  /** 사람이 검토·검수하는 시간 — 견적에 포함된다 */
  review_hours: z.number().nonnegative(),
  /** 구현 job이 쓸 것으로 예상하는 토큰 */
  estimated_agent_tokens: z.number().int().nonnegative(),
  /** AI 제안가 (원). 관리자가 조정할 수 있다. */
  proposed_amount: z.number().int().nonnegative(),
  estimated_days: z.string(),
  /** 관리자용 산출 근거 */
  rationale: z.string(),
  risks: z.array(z.string()).default([]),
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
