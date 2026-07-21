/**
 * 버퍼링 상태 문구 — spec.md §2
 *
 * 클라이언트는 대기 중에 이 문장을 본다. 에이전트 스트림에서 파생하되,
 * 내부 용어(도구 이름, 파일 경로)를 그대로 노출하지 않는다.
 */
import type { StreamEvent } from './claude.js'

const TOOL_PHRASE: Record<string, string> = {
  Read: '코드를 읽어보고 있어요',
  Grep: '관련된 부분을 찾고 있어요',
  Glob: '어떤 파일들이 있는지 보고 있어요',
  Task: '자세히 살펴보고 있어요',
}

/**
 * 스트림 이벤트 하나에서 보여줄 문구를 뽑는다.
 * 해당 없으면 null — 호출자가 직전 문구를 유지한다.
 */
export function statusTextFrom(ev: StreamEvent): string | null {
  if (ev.type === 'system' && ev.subtype === 'init') return '관련 코드를 확인하고 있어요'

  if (ev.type !== 'assistant') return null
  const message = ev.message as { content?: unknown } | undefined
  const content = message?.content
  if (!Array.isArray(content)) return null

  for (const block of content) {
    const b = block as { type?: string; name?: string }
    if (b.type === 'tool_use' && b.name) {
      return TOOL_PHRASE[b.name] ?? '내용을 확인하고 있어요'
    }
  }
  // 텍스트만 온 턴 = 생각을 정리하는 중
  return '답변을 정리하고 있어요'
}
