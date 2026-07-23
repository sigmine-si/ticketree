/**
 * 프로젝트별 설정 — spec.md §9 (projects.settings)
 *
 * 러너의 동작 중 프로젝트마다 달라지는 것만 여기 모은다.
 * 레인 정책(§16-9)과 달리 이건 프로젝트가 바꿔도 되는 값이다 —
 * 도구·권한·모델처럼 안전에 걸리는 것은 여기 두지 않는다.
 */

/** 구현 job이 커밋해도 되는 경로. 저장소 구조가 프로젝트마다 다르다. */
export const DEFAULT_CODE_PATHS = ['src', 'digest.md'] as const

/**
 * 이 경로가 바뀌면 배포에 DB 반영이 따라와야 한다.
 * 실제로 놓친 적이 있다 — 스키마에 컬럼 두 개가 늘어난 채 머지돼서,
 * db:push 를 손으로 돌리기 전까지 앱이 죽는 상태였다.
 */
export const DEFAULT_MIGRATION_PATHS = ['db/schema.ts', 'migrations/'] as const

export interface ProjectSettings {
  /** 예: 모노레포는 ['packages', 'scripts', 'digest.md'] */
  codePaths?: string[]
  /** 이 경로가 diff에 있으면 배포 전 DB 반영이 필요하다고 본다 */
  migrationPaths?: string[]
  /** 운영자에게 보여줄 DB 반영 명령 (플랫폼이 실행하지는 않는다) */
  migrateCommand?: string
}

/** diff에 마이그레이션 경로가 있으면 true. 판단은 여기 한 곳에서만 한다. */
export function needsMigration(settings: unknown, diff: string | null): boolean {
  if (!diff) return false
  const s = settings as ProjectSettings | null
  const paths = s?.migrationPaths?.length ? s.migrationPaths : [...DEFAULT_MIGRATION_PATHS]
  // diff 헤더(+++ b/...)만 본다 — 본문에 경로 문자열이 있다고 스키마 변경은 아니다
  const touched = diff.split('\n').filter((l) => l.startsWith('+++ ') || l.startsWith('--- '))
  return touched.some((l) => paths.some((p) => l.includes(p)))
}

export function migrateCommandOf(settings: unknown): string {
  return (settings as ProjectSettings | null)?.migrateCommand ?? 'pnpm db:push'
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
