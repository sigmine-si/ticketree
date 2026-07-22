/**
 * 주소 조립 — specs/overview.md '주소 규약'
 *
 * 클라이언트 화면 주소에는 프로젝트가 들어간다. 링크가 자기 자신을 설명해야
 * 관리자가 복사해 클라이언트에게 보낼 수 있다.
 *
 * 문자열을 화면마다 조립하면 다음 번 주소 변경 때 또 온 파일을 뒤져야 한다.
 */
export const clientPath = {
  requests: (slug: string) => `/${slug}/requests`,
  request: (slug: string, reqNo: number) => `/${slug}/requests/${reqNo}`,
  spec: (slug: string, f?: string) => (f ? `/${slug}/spec?f=${f}` : `/${slug}/spec`),
}

export const adminPath = {
  /** 큐는 여러 프로젝트를 한 판에 모아 보는 곳이라 slug가 없다 */
  queue: '/admin',
  request: (slug: string, id: string) => `/admin/${slug}/requests/${id}`,
}
