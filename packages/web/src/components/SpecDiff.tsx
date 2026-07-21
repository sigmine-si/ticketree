/**
 * Spec 변경안 diff — spec.md §5
 *
 * 승인 근거 3종의 첫 번째. 관리자는 이 diff를 보고 "에이전트를 풀어도 되는가"를 판단한다.
 * 원본은 GitHub에 있고 여기 있는 건 PR 생성 시점에 잡아둔 사본이다.
 */

interface Line {
  kind: 'add' | 'del' | 'ctx' | 'file' | 'hunk'
  text: string
}

/** 통합 diff를 화면용 줄로 쪼갠다. 파일 헤더와 hunk 표시는 따로 구분한다. */
function parse(diff: string): Array<{ file: string; lines: Line[] }> {
  const files: Array<{ file: string; lines: Line[] }> = []
  let current: { file: string; lines: Line[] } | null = null

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git')) {
      const m = raw.match(/b\/(.+)$/)
      current = { file: m?.[1] ?? raw, lines: [] }
      files.push(current)
      continue
    }
    if (!current) continue
    if (
      raw.startsWith('index ') ||
      raw.startsWith('--- ') ||
      raw.startsWith('+++ ') ||
      raw.startsWith('new file') ||
      raw.startsWith('deleted file') ||
      raw.startsWith('similarity ') ||
      raw.startsWith('rename ')
    ) {
      continue
    }
    if (raw.startsWith('@@')) {
      current.lines.push({ kind: 'hunk', text: raw })
      continue
    }
    if (raw.startsWith('+')) current.lines.push({ kind: 'add', text: raw.slice(1) })
    else if (raw.startsWith('-')) current.lines.push({ kind: 'del', text: raw.slice(1) })
    else current.lines.push({ kind: 'ctx', text: raw.slice(1) })
  }
  return files
}

export function SpecDiff({
  diff,
  prNumber,
  url,
  status,
}: {
  diff: string
  prNumber: number
  url: string
  status: string
}) {
  const files = parse(diff)

  return (
    <div className="card">
      <p className="ch">Spec 변경안</p>
      <p className="cs">
        승인하면 이 변경이 명세에 반영되고 개발이 시작돼요 ·{' '}
        <a href={url} target="_blank" rel="noreferrer" style={{ color: 'var(--green)' }}>
          GitHub PR #{prNumber} ↗
        </a>
        {status === 'merged' && ' · 머지 완료'}
      </p>

      {files.length === 0 ? (
        <p className="note" style={{ color: 'var(--faint)' }}>
          변경 내용을 읽지 못했어요 — PR에서 직접 확인해주세요
        </p>
      ) : (
        files.map((f) => {
          const added = f.lines.filter((l) => l.kind === 'add').length
          const removed = f.lines.filter((l) => l.kind === 'del').length
          return (
            <div className="diff" key={f.file} style={{ marginBottom: 10 }}>
              <div className="fname">
                <span>{f.file}</span>
                <span className="stat">
                  +{added}
                  {removed > 0 && ` −${removed}`}
                </span>
              </div>
              {f.lines.map((l, i) =>
                l.kind === 'hunk' ? (
                  <div className="dl hunk" key={i}>
                    <span className="g"> </span>
                    {l.text}
                  </div>
                ) : (
                  <div className={`dl ${l.kind}`} key={i}>
                    <span className="g">
                      {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}
                    </span>
                    {l.text}
                  </div>
                ),
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
