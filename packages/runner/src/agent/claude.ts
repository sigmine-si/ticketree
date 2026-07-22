/**
 * Claude Code headless 래퍼 — spec.md §6, §16-9, §16-10
 *
 * 이 파일이 에이전트 실행의 유일한 통로다. 여기서만 프로세스를 띄우고,
 * 플래그는 전부 LanePolicy에서 나온다. 호출자가 도구·권한을 못 바꾼다.
 */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { LanePolicy } from '@ticketree/shared'

export interface RunOptions {
  prompt: string
  cwd: string
  policy: LanePolicy
  /** 있으면 --resume으로 이어간다. 없으면 새 세션. */
  resumeSessionId?: string
  /** job 시점 지시 (§6 — CLAUDE.md 계층의 최하단) */
  appendSystemPrompt?: string
  /** 스트림 이벤트 콜백. 버퍼링 상태 문구와 원본 아카이브가 여기서 나온다. */
  onEvent?: (event: StreamEvent) => void
  /**
   * 최종 응답 텍스트가 생성되는 대로 조각으로 온다 (--include-partial-messages).
   * thinking과 도구 입력은 오지 않는다 — 텍스트 블록만이다.
   *
   * 이 조각을 클라이언트에게 그대로 흘리지 않는다. 실측에서 첫 조각이
   * "명세(specs/features/settlement.md:9," 였다 — 내부 경로가 그대로 나온다.
   * 무엇을 보여줄지는 호출자가 progress-line으로 걸러 정한다.
   */
  onTextDelta?: (chunk: string) => void
  signal?: AbortSignal
}

export interface StreamEvent {
  type: string
  subtype?: string
  [k: string]: unknown
}

export interface RunResult {
  sessionId: string
  /** init 이벤트가 보고한 실제 모델. 요청한 모델과 다를 수 있다(폴백). */
  model: string
  /** 최종 응답 텍스트 */
  text: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  numTurns: number
  durationMs: number
  /** 원본 스트림 — S3 아카이브용 (§6) */
  raw: string[]
}

export class AgentError extends Error {
  constructor(
    message: string,
    readonly detail: { raw: string[]; stderr: string; code: number | null },
  ) {
    super(message)
    this.name = 'AgentError'
  }
}

/**
 * 부모 환경에서 권한 우회 설정이 새어 들어오는 것을 막는다.
 * 실측에서 상속된 bypassPermissions로 실행된 사례가 있었다 (§16-9).
 */
function sanitizedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    const k = key.toUpperCase()
    if (k.includes('SKIP_PERMISSION') || k.includes('BYPASS_PERMISSION')) delete env[key]
  }
  // 러너는 인증 방식을 모른다 — 환경 변수 하나 차이로 API 키 전환이 끝난다 (§10)
  delete env.CLAUDE_CODE_ENTRYPOINT
  return env
}

function buildArgs(o: RunOptions): string[] {
  const { policy } = o
  const args = [
    '-p',
    o.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    policy.model,
    '--max-turns',
    String(policy.maxTurns),
    // 부모에서 상속받지 않고 항상 명시한다
    '--permission-mode',
    policy.permissionMode,
    '--effort',
    policy.effort,
    // 텍스트를 조각으로 받는다. 이게 없으면 assistant 메시지가 완성된 뒤에야 오고,
    // 실측에서 그 시점이 33초 실행의 27초 지점이었다.
    '--include-partial-messages',
  ]
  if (policy.tools) args.push('--tools', ...policy.tools)
  if (o.resumeSessionId) args.push('--resume', o.resumeSessionId)
  if (o.appendSystemPrompt) args.push('--append-system-prompt', o.appendSystemPrompt)
  return args
}

export async function runAgent(o: RunOptions): Promise<RunResult> {
  const args = buildArgs(o)
  const raw: string[] = []
  let stderr = ''

  const child = spawn('claude', args, {
    cwd: o.cwd, // 셸 cd에 의존하지 않는다 — cwd가 격리·세션·시야를 결정한다 (§6)
    env: sanitizedEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const timer = setTimeout(() => child.kill('SIGKILL'), o.policy.timeoutMs)
  const onAbort = () => child.kill('SIGTERM')
  o.signal?.addEventListener('abort', onAbort, { once: true })

  child.stderr.on('data', (d: Buffer) => {
    stderr += d.toString()
  })

  let sessionId = o.resumeSessionId ?? ''
  let model = o.policy.model
  let result: StreamEvent | undefined

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })
  rl.on('line', (line) => {
    if (!line.trim()) return
    raw.push(line)
    let ev: StreamEvent
    try {
      ev = JSON.parse(line) as StreamEvent
    } catch {
      return // 스트림 중 비-JSON 줄은 무시한다
    }
    if (typeof ev.session_id === 'string') sessionId = ev.session_id
    if (ev.type === 'system' && ev.subtype === 'init' && typeof ev.model === 'string') {
      model = ev.model
    }
    if (ev.type === 'result') result = ev
    if (o.onTextDelta && ev.type === 'stream_event') {
      const inner = ev.event as { type?: string; delta?: { type?: string; text?: string } }
      if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta') {
        // thinking_delta·input_json_delta는 여기 걸리지 않는다 — 의도적이다
        o.onTextDelta(inner.delta.text ?? '')
      } else if (inner?.type === 'content_block_stop') {
        // 블록 경계를 줄바꿈으로 알린다. 에이전트가 줄 끝에 개행을 안 넣는 경우가
        // 있어서, 이게 없으면 앞 블록의 문장과 다음 블록의 문장이 한 줄로 붙는다.
        o.onTextDelta('\n')
      }
    }
    o.onEvent?.(ev)
  })

  const code = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (c) => resolve(c))
  }).finally(() => {
    clearTimeout(timer)
    o.signal?.removeEventListener('abort', onAbort)
    rl.close()
  })

  if (code !== 0 || !result) {
    throw new AgentError(`claude exited with code ${code}`, { raw, stderr, code })
  }
  if (result.is_error) {
    throw new AgentError(String(result.result ?? 'agent reported an error'), {
      raw,
      stderr,
      code,
    })
  }

  const usage = (result.usage ?? {}) as Record<string, number>
  const cacheIn =
    (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)

  return {
    sessionId,
    model,
    text: String(result.result ?? ''),
    // 캐시 토큰을 입력에 합산한다 — 원가의 대부분이 여기서 나온다 (§8 실측)
    tokensIn: (usage.input_tokens ?? 0) + cacheIn,
    tokensOut: usage.output_tokens ?? 0,
    costUsd: Number(result.total_cost_usd ?? 0),
    numTurns: Number(result.num_turns ?? 0),
    durationMs: Number(result.duration_ms ?? 0),
    raw,
  }
}
