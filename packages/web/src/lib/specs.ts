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
 * 섹션 본문의 덩어리.
 *
 * 줄 단위로 다루면 문단이 줄바꿈마다 쪼개지고 표가 파이프 문자로 찍힌다.
 * 제품 정의처럼 문단과 표로 쓰는 문서에서 바로 드러났다.
 */
export type SpecBlock =
  | { kind: 'para'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'code'; text: string }
  | { kind: 'heading'; text: string }

/**
 * "이렇게 동작해요"·"변경 이력" 밖의 섹션. 알려진 제약, 구현 규칙 등이 여기 들어온다.
 *
 * 계약(클라이언트가 승인하는 문장)과 설계(우리가 지키는 규칙)를 한 파일에 둔다.
 * 문서가 갈리면 설계가 계약을 따라가지 못하고 썩는다. 대신 **화면에서 가른다** —
 * 클라이언트에게 `status='scheduled'` 같은 줄을 보여주면 승인할 수 없는 문서가 된다.
 */
export interface SpecSection {
  title: string
  blocks: SpecBlock[]
  /** true면 클라이언트 화면에 내보내지 않는다. 관리자는 명세 PR의 diff로 본다. */
  internal: boolean
}

/** 검색용 평문. 블록 구조를 모르는 곳(검색 haystack)에서 쓴다. */
export function sectionText(sec: SpecSection): string {
  return sec.blocks
    .map((b) =>
      b.kind === 'list'
        ? b.items.join(' ')
        : b.kind === 'table'
          ? [...b.head, ...b.rows.flat()].join(' ')
          : b.text,
    )
    .join(' ')
}

const cells = (line: string): string[] =>
  line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim())

const isTableRow = (l: string) => l.startsWith('|') && l.includes('|', 1)
const isSeparator = (l: string) => /^\|[\s:|-]+\|?$/.test(l)

/**
 * 줄 목록을 블록으로 묶는다. 마크다운 전부가 아니라 명세에 실제로 쓰는 것만 다룬다 —
 * 소제목·문단·불릿·표·코드블록. 형식은 우리가 정하는 것이므로 렌더러를 들이지 않는다.
 */
export function toBlocks(lines: string[]): SpecBlock[] {
  const blocks: SpecBlock[] = []
  let para: string[] = []
  let list: string[] = []

  const flush = () => {
    if (para.length) blocks.push({ kind: 'para', text: para.join(' ') })
    if (list.length) blocks.push({ kind: 'list', items: [...list] })
    para = []
    list = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    if (!line) {
      flush()
      continue
    }

    if (line.startsWith('```')) {
      flush()
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.startsWith('```')) body.push(lines[i]!), i++
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }

    if (line.startsWith('#')) {
      flush()
      blocks.push({ kind: 'heading', text: line.replace(/^#+\s*/, '') })
      continue
    }

    if (isTableRow(line)) {
      flush()
      const head = cells(line)
      const rows: string[][] = []
      i++
      if (i < lines.length && isSeparator(lines[i]!)) i++
      while (i < lines.length && isTableRow(lines[i]!)) rows.push(cells(lines[i]!)), i++
      i--
      blocks.push({ kind: 'table', head, rows })
      continue
    }

    if (/^[-*]\s/.test(line)) {
      if (para.length) flush()
      list.push(line.replace(/^[-*]\s*/, ''))
      continue
    }

    // 불릿 다음의 들여쓴 줄은 그 불릿의 이어지는 문장이다
    if (list.length) {
      list[list.length - 1] += ` ${line}`
      continue
    }
    para.push(line)
  }
  flush()
  return blocks
}

/** 제목만 보고 내부 섹션인지 판정한다. 표시하지 않는 쪽이 기본값이 아니므로 명시적이어야 한다. */
function isInternalHeading(h: string): boolean {
  return h.includes('내부') || h.includes('구현 규칙') || h.includes('설계')
}

/**
 * 명세는 세 층이다 (specs/product.md 참조).
 * product = 무엇을·누구를 위해, overview = 어느 기능도 혼자 소유하지 않는 것, feature = 각 기능.
 */
export type SpecLayer = 'product' | 'overview' | 'feature'

export interface FeatureSpec {
  layer: SpecLayer
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

export function parseSpec(slug: string, md: string, layer: SpecLayer = 'feature'): FeatureSpec {
  const lines = md.split('\n')
  let title = slug
  let version: string | null = null
  let lastChanged: string | null = null
  let order: number | null = null
  const criteria: Criterion[] = []
  const history: HistoryEntry[] = []

  let section: 'none' | 'criteria' | 'history' | 'other' = 'none'
  let current: { title: string; internal: boolean; lines: string[] } | null = null
  const rawSections: Array<{ title: string; internal: boolean; lines: string[] }> = []

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
        current = { title: h, internal: isInternalHeading(h), lines: [] }
        rawSections.push(current)
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
    } else if (section === 'other' && current) {
      current.lines.push(line)
    }
  }

  return {
    layer,
    slug,
    title,
    version,
    lastChanged,
    order,
    criteria,
    sections: rawSections
      .map((r) => ({ title: r.title, internal: r.internal, blocks: toBlocks(r.lines) }))
      .filter((s) => s.blocks.length > 0),
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
const LAYER_RANK: Record<SpecLayer, number> = { product: 0, overview: 1, feature: 2 }

function compareSpecs(a: FeatureSpec, b: FeatureSpec): number {
  if (a.layer !== b.layer) return LAYER_RANK[a.layer] - LAYER_RANK[b.layer]
  const oa = a.order ?? Number.MAX_SAFE_INTEGER
  const ob = b.order ?? Number.MAX_SAFE_INTEGER
  if (oa !== ob) return oa - ob
  return a.title.localeCompare(b.title, 'ko')
}

async function readOne(path: string, slug: string, layer: SpecLayer): Promise<FeatureSpec | null> {
  try {
    return parseSpec(slug, await readFile(path, 'utf8'), layer)
  } catch {
    // 아직 이 층이 없는 프로젝트가 있다 — 데모 저장소는 기능 명세만 갖는다
    return null
  }
}

/** 워크스페이스의 명세를 세 층 모두 읽는다. 없으면 빈 배열. */
export async function readSpecs(workspacePath: string): Promise<FeatureSpec[]> {
  const specsDir = join(workspacePath, 'specs')
  const featuresDir = join(specsDir, 'features')

  let names: string[] = []
  try {
    names = (await readdir(featuresDir)).filter((n) => n.endsWith('.md'))
  } catch {
    // 기능 명세가 없어도 product/overview는 있을 수 있다
  }

  const all = await Promise.all([
    readOne(join(specsDir, 'product.md'), 'product', 'product'),
    readOne(join(specsDir, 'overview.md'), 'overview', 'overview'),
    ...names.map((name) =>
      readOne(join(featuresDir, name), name.replace(/\.md$/, ''), 'feature'),
    ),
  ])
  return all.filter((s): s is FeatureSpec => s !== null).sort(compareSpecs)
}
