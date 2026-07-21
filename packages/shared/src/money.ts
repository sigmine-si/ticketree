/**
 * 금액 표기 — spec.md §8
 *
 * 에이전트 원가는 USD로 나오고 견적은 원이다. 둘을 나란히 보려면 환산이 필요한데,
 * 이 환산가는 **API 환산가이지 구독 실지출이 아니다**. 원가율은 참고 지표로만 쓴다.
 */

/** 표시용 고정 환율. 정산에 쓰지 않는다. */
export const USD_TO_KRW = Number(process.env.USD_TO_KRW ?? 1400)

export function usdToKrw(usd: number): number {
  return Math.round(usd * USD_TO_KRW)
}

export function formatKrw(won: number): string {
  return `₩${won.toLocaleString('ko-KR')}`
}

/** 원가율 (%) — 확정 견적 대비 AI 원가. 견적이 없으면 null. */
export function costRatio(monthTotalKrw: number, monthCostUsd: number): number | null {
  if (monthTotalKrw <= 0) return null
  return (usdToKrw(monthCostUsd) * 100) / monthTotalKrw
}
