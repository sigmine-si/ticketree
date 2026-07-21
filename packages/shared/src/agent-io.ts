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
