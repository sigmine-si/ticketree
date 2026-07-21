/**
 * 명세 읽기 — spec.md §3
 *
 * 진실은 Git이므로 DB가 아니라 허브 워크스페이스의 마크다운을 그대로 읽는다.
 * 웹과 러너는 같은 파일시스템에 있다 (§6).
 *
 * 파싱은 허브 CLAUDE.md가 에이전트에게 지시한 형식을 그대로 따른다.
 * 형식이 어긋난 줄은 버리지 않고 일반 항목으로 보여준다 — 클라이언트가
 * 빈 화면을 보는 것보다 낫다.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface Criterion {
  text: string
  /** false면 아직 배포 전 — "예정" 태그가 붙는다 */
  done: boolean
  /** 이 항목을 만든 요청 (예정 항목에만 있다) */
  reqTag: string | null
}

export interface HistoryEntry {
  version: string
  reqTag: string | null
  text: string
}

export interface FeatureSpec {
  /** 파일명에서 온 식별자 (settlement) */
  slug: string
  /** 문서 제목 (판매자 정산) */
  title: string
  version: string | null
  lastChanged: string | null
  criteria: Criterion[]
  history: HistoryEntry[]
  /** 예정 항목이 있으면 상단에 안내가 뜬다 */
  pendingReqTags: string[]
}

const PENDING = /^\((?:예정\s*·\s*)?(REQ-\d+)\)\s*/

function parseCriterion(line: string): Criterion | null {
  const m = line.match(/^-\s*\[( |x|X)\]\s*(.+)$/)
  if (!m) return null
  const done = m[1]!.toLowerCase() === 'x'
  let text = m[2]!.trim()
  let reqTag: string | null = null

  const p = text.match(PENDING)
  if (p) {
    reqTag = p[1]!
    text = text.slice(p[0].length).trim()
  }
  return { text, done, reqTag }
}

/** v1.10이 v1.9보다 크도록 자리별로 비교한다 — 문자열 비교로는 뒤집힌다. */
function compareVersion(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

function parseHistory(line: string): HistoryEntry | null {
  // - v1.1 (REQ-001) 정산 예정일 표기를 …
  const m = line.match(/^-\s*(v[\d.]+)\s*(?:\((REQ-\d+)\))?\s*(.*)$/)
  if (!m) return null
  return { version: m[1]!, reqTag: m[2] ?? null, text: m[3]!.trim() }
}

export function parseSpec(slug: string, md: string): FeatureSpec {
  const lines = md.split('\n')
  let title = slug
  let version: string | null = null
  let lastChanged: string | null = null
  const criteria: Criterion[] = []
  const history: HistoryEntry[] = []

  let section: 'none' | 'criteria' | 'history' = 'none'

  for (const raw of lines) {
    const line = raw.trim()

    if (line.startsWith('# ')) {
      title = line.slice(2).trim()
      continue
    }
    if (line.startsWith('## ')) {
      const h = line.slice(3).trim()
      section = h.includes('변경 이력') ? 'history' : h.includes('동작') ? 'criteria' : 'none'
      continue
    }
    if (line.startsWith('버전:')) {
      version = line.match(/(v[\d.]+)/)?.[1] ?? null
      lastChanged = line.match(/마지막 변경\s*([\d-]+)/)?.[1] ?? null
      continue
    }

    if (section === 'criteria') {
      const c = parseCriterion(line)
      if (c) criteria.push(c)
    } else if (section === 'history') {
      const h = parseHistory(line)
      if (h) history.push(h)
    }
  }

  return {
    slug,
    title,
    version,
    lastChanged,
    criteria,
    // 최신이 위로 온다. 파일에 어떤 순서로 쌓였든 화면은 항상 최신순이다.
    history: history.sort((a, b) => compareVersion(b.version, a.version)),
    pendingReqTags: [...new Set(criteria.filter((c) => !c.done && c.reqTag).map((c) => c.reqTag!))],
  }
}

/** 허브 워크스페이스의 명세를 전부 읽는다. 없으면 빈 배열. */
export async function readSpecs(workspacePath: string): Promise<FeatureSpec[]> {
  const dir = join(workspacePath, 'specs', 'features')
  let names: string[]
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.md'))
  } catch {
    return []
  }

  const specs = await Promise.all(
    names.map(async (name) => {
      const slug = name.replace(/\.md$/, '')
      return parseSpec(slug, await readFile(join(dir, name), 'utf8'))
    }),
  )
  return specs.sort((a, b) => a.title.localeCompare(b.title, 'ko'))
}
