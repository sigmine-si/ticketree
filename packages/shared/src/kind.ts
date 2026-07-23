/**
 * 요청의 종류 — 변경 요청과 과업내용서
 *
 * 과업내용서(SOW)는 계약(발주) 단위다. 1차 구축, 2차 고도화로 쌓인다.
 * 변경 요청과 같은 테이블에 사는 이유는 대화·질문·세션·job·이벤트·PR이
 * 전부 request_id를 물고 있어서다 — 별도 테이블로 빼면 그 여덟을 복제해야 한다.
 *
 * DB를 끌고 오지 않는 순수 모듈이다. 클라이언트 컴포넌트가 직접 import한다.
 */

export const REQUEST_KINDS = ['change', 'sow'] as const
export type RequestKind = (typeof REQUEST_KINDS)[number]

/**
 * 번호 앞에 붙는 말머리.
 * 태그가 자기 종류를 말해야 명세의 `(예정 · SOW-001)`에서 역추적이 된다.
 */
export const TAG_PREFIX: Record<RequestKind, string> = {
  change: 'REQ',
  sow: 'SOW',
}

/** 클라이언트 화면에 그대로 나가는 이름 */
export const KIND_LABEL: Record<RequestKind, string> = {
  change: '요청',
  sow: '과업내용서',
}

/** 'SOW-001' — 지금까지 네 곳에 흩어져 있던 조립을 여기로 모은다. */
export function requestTag(kind: RequestKind, no: number | null): string {
  return `${TAG_PREFIX[kind]}-${String(no ?? 0).padStart(3, '0')}`
}

/** 한 건만 찾을 때. 여러 개를 훑으려면 tagMatches를 쓴다(g 플래그의 lastIndex를 피한다). */
export const TAG_RE = /\b(REQ|SOW)-(\d+)/

export function parseTag(s: string): { kind: RequestKind; no: number } | null {
  const m = TAG_RE.exec(s)
  if (!m) return null
  return { kind: m[1] === 'SOW' ? 'sow' : 'change', no: Number(m[2]) }
}

/** 문장 안의 모든 태그. 명세 본문의 예정 표기를 훑을 때 쓴다. */
export function tagMatches(s: string): { kind: RequestKind; no: number }[] {
  return [...s.matchAll(/\b(REQ|SOW)-(\d+)/g)].map((m) => ({
    kind: m[1] === 'SOW' ? ('sow' as const) : ('change' as const),
    no: Number(m[2]),
  }))
}
