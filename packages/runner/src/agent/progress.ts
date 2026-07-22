/**
 * 진행 문구 추출 — spec.md §2, §16-11
 *
 * 왜 이런 방식인가. 실측(2026-07-22, 그린루프 33초 실행):
 *  - 첫 텍스트 조각이 27.3초 지점에 나온다. 그 앞은 전부 도구 호출과 thinking이다.
 *  - 그 첫 조각이 "명세(specs/features/settlement.md:9," 였다 — 내부 경로가 그대로다.
 *
 * 그래서 응답을 그대로 흘리지 않는다. 에이전트가 작업 도중 클라이언트용 한 줄을
 * `[진행] ...` 형식으로 직접 쓰게 하고, 러너는 **그 줄만** 골라낸다. 마커가 없는
 * 텍스트(내부 분석, 최종 JSON)는 클라이언트에게 가지 않는다.
 */

const MARKER = '[진행]'
/** 상태줄 한 줄에 들어갈 만큼만. 넘치면 자른다. */
const MAX_LEN = 60

/**
 * 이 말이 들어간 줄은 버린다. 프롬프트로 금지해도 새어 나온다 —
 * 실측에서 "코드를 확인했어요"가 그대로 나왔다. 마지막 방어선은 러너다 (§10).
 * 버리면 직전 문구가 그대로 유지되므로 화면이 비지는 않는다.
 */
const BANNED = [
  '코드',
  '파일',
  '함수',
  '클래스',
  '리포',
  'repo',
  'PR',
  'git',
  '브랜치',
  '커밋',
  '머지',
  '.ts',
  '.md',
  '/',
]

export interface ProgressReader {
  /** 스트림 조각을 넣는다. 완성된 진행 문구가 있으면 돌려준다. */
  push(chunk: string): string[]
}

export function createProgressReader(): ProgressReader {
  let buffer = ''

  return {
    push(chunk: string): string[] {
      buffer += chunk
      const lines = buffer.split('\n')
      // 마지막 조각은 아직 줄이 안 끝났을 수 있으니 버퍼에 남긴다
      buffer = lines.pop() ?? ''

      const out: string[] = []
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith(MARKER)) continue
        const text = trimmed.slice(MARKER.length).trim()
        if (!text) continue
        if (BANNED.some((w) => text.includes(w))) continue
        out.push(text.length > MAX_LEN ? `${text.slice(0, MAX_LEN - 1)}…` : text)
      }
      return out
    },
  }
}

/** 시스템 프롬프트에 붙이는 지시. 진행 문구를 쓰는 job이 공유한다. */
export const PROGRESS_INSTRUCTION = `## 진행 문구 — 응답의 첫 줄부터 지킨다

클라이언트는 답이 나올 때까지 화면 앞에서 기다린다. 그 시간이 30초~2분인데
그동안 화면이 안 바뀌면 멈춘 것으로 본다. 그래서 작업 도중 아래 형식으로 남긴다.

\`[진행] 지금 무엇을 하는 중인지 한 문장\`

**규칙 1. 응답의 맨 첫 줄은 반드시 \`[진행] \` 으로 시작한다.**
도구를 하나라도 쓰기 전에, 무엇부터 확인할지 한 문장으로 먼저 쓴다.
이 줄이 늦게 나오면 클라이언트는 그만큼 빈 화면을 본다 — 늦게 쓰면 소용이 없다.

**규칙 2. 그 뒤로도 작업의 성격이 바뀔 때마다 한 줄씩 남긴다.** 최소 세 줄이 된다
(시작할 때 · 확인하는 중 · 정리할 때).

**규칙 3. 클라이언트가 읽는 문장이다.** 파일명·함수명·기술 용어를 쓰지 않는다.
**"코드"라는 말도 쓰지 않는다** — 클라이언트에게는 우리가 무엇을 뒤지는지가 아니라
무엇을 확인하는 중인지가 필요하다. "settlement.md를 읽는 중"도, "코드를 확인했어요"도
아니라 "정산 규칙이 어떻게 약속돼 있는지 보고 있어요"라고 쓴다.
30자 안쪽으로, "~하고 있어요"로 쓴다.

이 줄은 최종 JSON과 별개다. JSON은 그대로 맨 마지막에 낸다.`
