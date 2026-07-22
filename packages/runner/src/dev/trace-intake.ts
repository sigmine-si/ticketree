/**
 * 개발용 — 탐색 라운드의 턴별 타임라인을 찍는다.
 *
 * "왜 2분 걸리는가"에 답하기 위한 계측. DB에 아무것도 쓰지 않는다.
 *
 *   pnpm --filter @ticketree/runner exec tsx src/dev/trace-intake.ts ["요청"]
 */
import { eq } from 'drizzle-orm'
import { closeDb, createDb, policyForJob, projects } from '@ticketree/shared'
import { runAgent, type StreamEvent } from '../agent/claude.js'
import { firstRoundPrompt, INTAKE_SYSTEM } from '../jobs/intake-prompt.js'

const db = createDb()
const [project] = await db.select().from(projects).where(eq(projects.slug, process.env.PROJECT_SLUG ?? 'cafe-app'))
if (!project?.workspacePath) throw new Error('seed를 먼저 실행하세요')

const toBe =
  process.argv[2] ??
  '10잔 마시면 1잔 무료 쿠폰이 자동으로 나오고, 주문할 때 자동 적용되면 좋겠어요.'

interface Turn {
  at: number
  kind: string
  detail: string
}

const t0 = Date.now()
const turns: Turn[] = []
let assistantTurns = 0

function describe(ev: StreamEvent): Turn | null {
  const at = Date.now() - t0

  if (ev.type === 'system' && ev.subtype === 'init') {
    return { at, kind: 'init', detail: String(ev.model ?? '') }
  }
  if (ev.type !== 'assistant') return null

  const content = (ev.message as { content?: unknown } | undefined)?.content
  if (!Array.isArray(content)) return null

  assistantTurns++
  const parts: string[] = []
  for (const block of content) {
    const b = block as { type?: string; name?: string; input?: Record<string, unknown>; text?: string }
    if (b.type === 'tool_use') {
      const input = b.input ?? {}
      const target =
        (input.file_path as string) ??
        (input.pattern as string) ??
        (input.command as string) ??
        ''
      parts.push(`${b.name}(${String(target).replace(project!.workspacePath!, '.')})`)
    } else if (b.type === 'text' && b.text?.trim()) {
      parts.push(`text[${b.text.trim().length}자]`)
    }
  }
  return { at, kind: `turn ${assistantTurns}`, detail: parts.join('  ') || '—' }
}

console.log(`탐색 시작 — cwd: ${project.workspacePath}\n`)

const run = await runAgent({
  prompt: firstRoundPrompt({ asIs: null, toBe, urgency: null, attachmentNote: null }),
  cwd: project.workspacePath,
  policy: policyForJob('exploration'),
  appendSystemPrompt: INTAKE_SYSTEM,
  onEvent: (ev) => {
    const t = describe(ev)
    if (t) turns.push(t)
  },
})

// ── 타임라인
let prev = 0
for (const t of turns) {
  const delta = t.at - prev
  prev = t.at
  console.log(
    `${String((t.at / 1000).toFixed(1)).padStart(6)}s  +${String((delta / 1000).toFixed(1)).padStart(5)}s  ${t.kind.padEnd(8)} ${t.detail}`,
  )
}

// ── 도구 사용 집계
const toolCounts = new Map<string, number>()
for (const t of turns) {
  for (const m of t.detail.matchAll(/(\w+)\(/g)) {
    toolCounts.set(m[1]!, (toolCounts.get(m[1]!) ?? 0) + 1)
  }
}

console.log('\n── 요약')
console.log(`총 소요      : ${(run.durationMs / 1000).toFixed(1)}초`)
console.log(`어시스턴트 턴: ${assistantTurns} (result가 보고한 num_turns: ${run.numTurns})`)
console.log(`도구 호출    : ${[...toolCounts].map(([k, v]) => `${k}×${v}`).join(', ')}`)
console.log(`토큰         : in ${run.tokensIn.toLocaleString()} / out ${run.tokensOut.toLocaleString()}`)
console.log(`턴당 평균    : ${(run.durationMs / 1000 / Math.max(assistantTurns, 1)).toFixed(1)}초`)

await closeDb()
