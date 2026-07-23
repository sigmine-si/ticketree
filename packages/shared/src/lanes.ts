/**
 * 레인과 실행 정책 — spec.md §6, §16-9
 *
 * 핵심 불변식: job kind가 레인을 결정하고, 레인이 도구·모델·cwd 정책을 결정한다.
 * 프롬프트는 이것을 바꿀 수 없다. 러너는 여기서 나온 플래그만 사용한다.
 */

export const LANES = ['chat', 'spec', 'work'] as const
export type Lane = (typeof LANES)[number]

export const JOB_KINDS = [
  'exploration',
  'intake_round',
  'estimation',
  // 과업내용서 — 접수 대화와 같은 이유로 둘이다(새 세션 / --resume 재개)
  'sow_intake',
  'sow_round',
  'sow_spec_draft',
  'spec_draft',
  'spec_merge',
  'implementation',
  'onboarding',
  'deploy',
  'deploy_finalize',
] as const
export type JobKind = (typeof JOB_KINDS)[number]

export const JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

/** job kind → 레인. 이 표가 read-only 강제의 시작점이다. */
export const LANE_OF_JOB: Record<JobKind, Lane> = {
  exploration: 'chat',
  intake_round: 'chat',
  estimation: 'chat',
  // 과업내용서 대화도 클라이언트가 쓴 문장이 컨텍스트에 들어온다 — read-only 대화 레인이다.
  sow_intake: 'chat',
  sow_round: 'chat',
  // 명세 작성은 쓰기다 — 대화 레인(read-only)에 둘 수 없다.
  spec_draft: 'spec',
  sow_spec_draft: 'spec',
  implementation: 'work',
  onboarding: 'work',
  // 아래 셋은 에이전트를 쓰지 않는다 — 러너가 직접 머지·배포한다 (§1).
  spec_merge: 'work',
  deploy: 'work',
  deploy_finalize: 'work',
}

/** 에이전트를 띄우지 않고 러너가 직접 처리하는 job. 비가역적 동작이 여기 모인다. */
export const RUNNER_ONLY_JOBS: readonly JobKind[] = ['spec_merge', 'deploy', 'deploy_finalize']

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
  /**
   * 명세 작성 레인. 파일을 고치되 git은 만지지 않는다.
   *
   * Bash를 일부러 뺐다. 브랜치·커밋·push·PR 생성은 러너가 한다 —
   * 이 레인의 컨텍스트에는 클라이언트가 쓴 문장이 들어오므로(§10 입력 불신),
   * 임의 명령 실행을 열어줄 이유가 없다. 게다가 브랜치명·커밋 메시지는
   * 결정적이어야 추적이 된다.
   */
  spec: {
    tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write'],
    permissionMode: 'acceptEdits',
    model: 'claude-sonnet-5',
    effort: 'medium',
    maxTurns: 40,
    timeoutMs: 10 * 60_000,
    writable: true,
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
