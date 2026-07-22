/**
 * 버퍼링 상태 문구 — spec.md §2
 *
 * 클라이언트는 대기 중에 이 문장을 본다.
 *
 * 한 문장으로 고정했다. 도구 호출마다 문구를 바꿨더니("코드를 읽어보고 있어요",
 * "어떤 파일들이 있는지 보고 있어요") 기계가 무엇을 하는지만 보이고 그래서 지금
 * 무엇을 하려는 것인지는 안 보였다. 클라이언트가 알아야 하는 건 하나다 —
 * 지금 요청을 확정하는 중이라는 것.
 */
import type { StreamEvent } from './claude.js'

export const STATUS_TEXT = '요청 내용을 확정하기 위해 살펴보고 있어요'

/** 스트림 이벤트와 무관하게 같은 문구를 낸다. 호출자는 처음 한 번만 반영한다. */
export function statusTextFrom(_ev: StreamEvent): string | null {
  return STATUS_TEXT
}
