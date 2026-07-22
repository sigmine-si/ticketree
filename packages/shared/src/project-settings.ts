/**
 * 프로젝트별 설정 — spec.md §9 (projects.settings)
 *
 * 러너의 동작 중 프로젝트마다 달라지는 것만 여기 모은다.
 * 레인 정책(§16-9)과 달리 이건 프로젝트가 바꿔도 되는 값이다 —
 * 도구·권한·모델처럼 안전에 걸리는 것은 여기 두지 않는다.
 */

/** 구현 job이 커밋해도 되는 경로. 저장소 구조가 프로젝트마다 다르다. */
export const DEFAULT_CODE_PATHS = ['src', 'digest.md'] as const

export interface ProjectSettings {
  /** 예: 모노레포는 ['packages', 'scripts', 'digest.md'] */
  codePaths?: string[]
}

/**
 * 에이전트가 엉뚱한 곳을 고쳤어도 이 경로 밖은 커밋되지 않는다.
 * `specs/`는 여기 넣지 않는다 — 명세는 이미 승인·머지된 뒤다.
 */
export function codePathsOf(settings: unknown): string[] {
  const paths = (settings as ProjectSettings | null)?.codePaths
  if (!Array.isArray(paths) || paths.length === 0) return [...DEFAULT_CODE_PATHS]
  return paths.filter((p) => typeof p === 'string' && p.length > 0 && !p.startsWith('..'))
}
