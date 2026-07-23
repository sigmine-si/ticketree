/**
 * 주소 조립 — 주소 규약
 *
 * 클라이언트 화면 주소에는 프로젝트가 들어간다. 링크가 자기 자신을 설명해야
 * 관리자가 복사해 클라이언트에게 보낼 수 있다.
 *
 * 문자열을 화면마다 조립하면 다음 번 주소 변경 때 또 온 파일을 뒤져야 한다.
 */
export const clientPath = {
  requests: (slug: string) => `/${slug}/requests`,
  request: (slug: string, reqNo: number) => `/${slug}/requests/${reqNo}`,
  /** 과업내용서 — 계약 단위라 요청과 목록이 갈린다 */
  sows: (slug: string) => `/${slug}/sow`,
  sow: (slug: string, sowNo: number) => `/${slug}/sow/${sowNo}`,
  spec: (slug: string, f?: string) => (f ? `/${slug}/spec?f=${f}` : `/${slug}/spec`),
  /** 로그인하지 않은 사람이 닿는 곳. 들어오는 문은 초대 링크뿐이라 안내만 한다. */
  login: '/login',
  /** 관리자가 복사해 전달하는 주소. 토큰 평문은 이 링크에만 남는다. */
  invite: (token: string) => `/invite/${token}`,
}

export const adminPath = {
  /** 큐는 여러 프로젝트를 한 판에 모아 보는 곳이라 slug가 없다 */
  queue: '/admin',
  request: (slug: string, id: string) => `/admin/${slug}/requests/${id}`,
  /** 고객 계정 — 초대 링크·PIN 발급 */
  invites: '/admin/invites',
  /** 원가 — 요청별·job별 실제 소요와 환산 원가 (§8) */
  costs: '/admin/costs',
}
