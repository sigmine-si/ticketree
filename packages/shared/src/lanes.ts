/**
 * 레인과 실행 정책 — spec.md §6, §16-9
 *
 * 핵심 불변식: job kind가 레인을 결정하고, 레인이 도구·모델·cwd 정책을 결정한다.
 * 프롬프트는 이것을 바꿀 수 없다. 러너는 여기서 나온 플래그만 사용한다.
 */

export const LANES = ['chat', 'work'] as const
export type Lane = (typeof LANES)[number]

export const JOB_KINDS = [
  'exploration',
  'intake_round',
  'estimation',
  'implementation',
  'onboarding',
  'deploy',
] as const
export type JobKind = (typeof JOB_KINDS)[number]

export const JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

/** job kind → 레인. 이 표가 read-only 강제의 시작점이다. */
export const LANE_OF_JOB: Record<JobKind, Lane> = {
  exploration: 'chat',
  intake_round: 'chat',
  estimation: 'chat',
  implementation: 'work',
  onboarding: 'work',
  // deploy는 에이전트를 쓰지 않는다 — 러너가 직접 머지·배포한다.
  deploy: 'work',
}

export interface LanePolicy {
  /** --tools 화이트리스트. undefined면 전체 도구 허용(work 레인). */
  readonly tools?: readonly string[]
  /** --permission-mode. 부모 환경에서 상속받지 않고 항상 명시한다. */
  readonly permissionMode: string
  readonly model: string
  /**
   * --effort. 계측 결과 대화 레인의 지연은 파일 탐색(~5초)이 아니라
   * thinking 토큰이 지배한다. 여기가 속도 예산의 실제 손잡이다.
   */
  readonly effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  readonly maxTurns: number
  /** 밀리초. 초과 시 러너가 프로세스를 죽인다. */
  readonly timeoutMs: number
  readonly writable: boolean
}

/**
 * 대화 레인은 Read·Grep·Glob만 준다.
 * Bash가 빠진 것이 의도적이다 — Bash는 쓰기와 네트워크를 모두 열어준다.
 */
export const LANE_POLICY: Record<Lane, LanePolicy> = {
  chat: {
    tools: ['Read', 'Grep', 'Glob'],
    permissionMode: 'default',
    model: 'claude-sonnet-5',
    effort: 'medium',
    maxTurns: 30,
    timeoutMs: 5 * 60_000,
    writable: false,
  },
  work: {
    tools: undefined,
    permissionMode: 'acceptEdits',
    model: 'claude-opus-4-8',
    // 구현은 정확도가 속도보다 중요하다 — 여기서는 아끼지 않는다
    effort: 'high',
    maxTurns: 120,
    timeoutMs: 45 * 60_000,
    writable: true,
  },
}

export function policyForJob(kind: JobKind): LanePolicy {
  return LANE_POLICY[LANE_OF_JOB[kind]]
}
