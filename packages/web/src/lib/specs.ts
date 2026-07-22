/**
 * 명세 읽기 — spec.md §3
 *
 * 진실은 Git이므로 DB가 아니라 허브 워크스페이스의 마크다운을 그대로 읽는다.
 * 웹과 러너는 같은 파일시스템에 있다 (§6).
 *
 * 파싱 원칙: **아무것도 조용히 버리지 않는다.** 아는 형식은 아는 대로 렌더하고,
 * 모르는 형식은 모르는 대로 보여준다. 클라이언트에게 명세는 계약서라,
 * 파일에 있는데 화면에 없는 문장이 생기면 그 전제가 무너진다.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * done    = 배포되어 지금 동작하는 항목 (- [x])
 * pending = 승인됐지만 아직 배포 전 (- [ ])
 * plain   = 체크박스 없이 적힌 줄. 우리 형식을 안 따르는 문서에서 온다 —
 *           상태를 단정할 수 없으므로 완료로도 예정으로도 표시하지 않는다.
 */
export type Mark = 'done' | 'pending' | 'plain'

export interface Criterion {
  text: string
  mark: Mark
  /** 이 항목을 만든 요청 (예정 항목에만 있다) */
  reqTag: string | null
}

export interface HistoryEntry {
  version: string
  reqTag: string | null
  /** YYYY-MM-DD. 옛 문서에는 없다. */
  date: string | null
  text: string
}

/**
 * "이렇게 동작해요"·"변경 이력" 밖의 섹션. 알려진 제약, 구현 규칙 등이 여기 들어온다.
 *
 * 계약(클라이언트가 승인하는 문장)과 설계(우리가 지키는 규칙)를 한 파일에 둔다.
 * 문서가 갈리면 설계가 계약을 따라가지 못하고 썩는다. 대신 **화면에서 가른다** —
 * 클라이언트에게 `status='scheduled'` 같은 줄을 보여주면 승인할 수 없는 문서가 된다.
 */
export interface SpecSection {
  title: string
  items: string[]
  /** true면 클라이언트 화면에 내보내지 않는다. 관리자는 명세 PR의 diff로 본다. */
  internal: boolean
}

/** 제목만 보고 내부 섹션인지 판정한다. 표시하지 않는 쪽이 기본값이 아니므로 명시적이어야 한다. */
function isInternalHeading(h: string): boolean {
  return h.includes('내부') || h.includes('구현 규칙') || h.includes('설계')
}

export interface FeatureSpec {
  /** 파일명에서 온 식별자 (settlement) */
  slug: string
  /** 문서 제목 (판매자 정산) */
  title: string
  version: string | null
  lastChanged: string | null
  /** 목록에서의 자리. 없으면 뒤로 밀린다 (§3 — 읽는 순서가 서비스 흐름을 따라야 한다) */
  order: number | null
  criteria: Criterion[]
  sections: SpecSection[]
  history: HistoryEntry[]
  /** 예정 항목이 있으면 상단에 안내가 뜬다 */
  pendingReqTags: string[]
}

const PENDING = /^\((?:예정\s*·\s*)?(REQ-\d+)\)\s*/

function parseCriterion(line: string): Criterion | null {
  if (!line) return null

  const box = line.match(/^-\s*\[( |x|X)\]\s*(.+)$/)
  // 체크박스가 없는 줄도 버리지 않는다. 우리가 만들지 않은 문서를 온보딩하면
  // 대부분 이 형태다 — 버리면 클라이언트는 빈 화면을 본다.
  const raw = box ? box[2]!.trim() : line.replace(/^[-*]\s*/, '').trim()
  if (!raw) return null

  const mark: Mark = box ? (box[1]!.toLowerCase() === 'x' ? 'done' : 'pending') : 'plain'

  let text = raw
  let reqTag: string | null = null
  const p = text.match(PENDING)
  if (p) {
    reqTag = p[1]!
    text = text.slice(p[0].length).trim()
  }
  return { text, mark, reqTag }
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
  // - v1.1 (REQ-001) 2026-07-22 정산 예정일 표기를 …   (날짜는 선택)
  const m = line.match(/^-\s*(v[\d.]+)\s*(?:\((REQ-\d+)\))?\s*(\d{4}-\d{2}-\d{2})?\s*(.*)$/)
  if (!m) return null
  return { version: m[1]!, reqTag: m[2] ?? null, date: m[3] ?? null, text: m[4]!.trim() }
}

export function parseSpec(slug: string, md: string): FeatureSpec {
  const lines = md.split('\n')
  let title = slug
  let version: string | null = null
  let lastChanged: string | null = null
  let order: number | null = null
  const criteria: Criterion[] = []
  const history: HistoryEntry[] = []
  const sections: SpecSection[] = []

  let section: 'none' | 'criteria' | 'history' | 'other' = 'none'
  let current: SpecSection | null = null

  for (const raw of lines) {
    const line = raw.trim()

    if (line.startsWith('# ')) {
      title = line.slice(2).trim()
      continue
    }
    if (line.startsWith('## ')) {
      const h = line.slice(3).trim()
      if (h.includes('변경 이력')) {
        section = 'history'
        current = null
      } else if (h.includes('동작')) {
        section = 'criteria'
        current = null
      } else {
        // 모르는 섹션도 그대로 들고 간다 (알려진 제약, 구현 규칙 등)
        section = 'other'
        current = { title: h, items: [], internal: isInternalHeading(h) }
        sections.push(current)
      }
      continue
    }
    if (line.startsWith('버전:')) {
      version = line.match(/(v[\d.]+)/)?.[1] ?? null
      lastChanged = line.match(/마지막 변경\s*([\d-]+)/)?.[1] ?? null
      continue
    }
    if (line.startsWith('순서:')) {
      const n = Number(line.match(/(\d+)/)?.[1])
      order = Number.isFinite(n) ? n : null
      continue
    }

    if (section === 'criteria') {
      const c = parseCriterion(line)
      if (c) criteria.push(c)
    } else if (section === 'history') {
      const h = parseHistory(line)
      if (h) history.push(h)
    } else if (section === 'other' && current && line) {
      current.items.push(line.replace(/^[-*]\s*/, '').trim())
    }
  }

  return {
    slug,
    title,
    version,
    lastChanged,
    order,
    criteria,
    sections: sections.filter((s) => s.items.length > 0),
    // 최신이 위로 온다. 파일에 어떤 순서로 쌓였든 화면은 항상 최신순이다.
    history: history.sort((a, b) => compareVersion(b.version, a.version)),
    pendingReqTags: [
      ...new Set(criteria.filter((c) => c.mark === 'pending' && c.reqTag).map((c) => c.reqTag!)),
    ],
  }
}

/** 클라이언트에게 보여줄 섹션만. 페이지가 이걸 안 거치고 sections를 직접 쓰면 설계가 샌다. */
export function clientSections(spec: FeatureSpec): SpecSection[] {
  return spec.sections.filter((s) => !s.internal)
}

/**
 * 목록 순서 — 서비스를 겪는 순서대로 읽히게 한다.
 * `순서:`가 없는 문서는 뒤로 보내고 제목 가나다순으로 정렬한다.
 */
function compareSpecs(a: FeatureSpec, b: FeatureSpec): number {
  const oa = a.order ?? Number.MAX_SAFE_INTEGER
  const ob = b.order ?? Number.MAX_SAFE_INTEGER
  if (oa !== ob) return oa - ob
  return a.title.localeCompare(b.title, 'ko')
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
  return specs.sort(compareSpecs)
}
