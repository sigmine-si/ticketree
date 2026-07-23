/**
 * 명세 섹션 본문 렌더 — spec.md §3
 *
 * 마크다운 렌더러를 들이지 않는다. 명세 형식은 우리가 정하는 것이고, 실제로 쓰는 건
 * 소제목·문단·불릿·표·코드블록과 인라인 강조·코드·링크뿐이다. 파서가 아는 만큼만 그린다.
 */
import type { ReactNode } from 'react'
import type { SpecBlock } from '@/lib/specs'

/** `**굵게**` · `` `코드` `` · `[글](주소)` 만 다룬다. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0

  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1] !== undefined) out.push(<strong key={key++}>{m[1]}</strong>)
    else if (m[2] !== undefined) out.push(<code key={key++}>{m[2]}</code>)
    else out.push(
      <a key={key++} href={m[4]}>
        {m[3]}
      </a>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function InlineText({ text }: { text: string }) {
  return <>{inline(text)}</>
}

export function SpecBody({ blocks }: { blocks: SpecBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === 'heading') {
          return (
            <p className="sb-h" key={i}>
              {inline(b.text)}
            </p>
          )
        }
        if (b.kind === 'para') {
          return (
            <p className="sb-p" key={i}>
              {inline(b.text)}
            </p>
          )
        }
        if (b.kind === 'code') {
          return (
            <pre className="sb-code" key={i}>
              {b.text}
            </pre>
          )
        }
        if (b.kind === 'list') {
          return (
            <ul className="sb-list" key={i}>
              {b.items.map((item, j) => (
                <li key={j}>{inline(item)}</li>
              ))}
            </ul>
          )
        }
        return (
          // 좁은 화면에서 표만 가로로 스크롤한다 — 본문이 밀려나면 안 된다
          <div className="sb-tablewrap" key={i}>
            <table className="sb-table">
              <thead>
                <tr>
                  {b.head.map((h, j) => (
                    <th key={j}>{inline(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, j) => (
                  <tr key={j}>
                    {row.map((c, k) => (
                      <td key={k}>{inline(c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </>
  )
}
