/**
 * 상태 머신 — spec.md §7, §16-7
 *
 * 내부 status와 클라이언트에게 보이는 stage를 분리한다.
 * 관리자 Spec 승인 대기 구간은 클라이언트에게 "개발 중"으로 보인다.
 */

export const REQUEST_STATUSES = [
  'draft',
  'submitted',
  'queued_exploration',
  'exploring',
  'awaiting_client',
  'estimating',
  'quote_ready',
  'client_approved',
  'queued_dev',
  'developing',
  'in_review',
  'awaiting_manual_deploy',
  'deployed',
] as const

export type RequestStatus = (typeof REQUEST_STATUSES)[number]

/** 클라이언트에게 보이는 4단계. draft는 티켓이 아직 없으므로 비노출. */
export const STAGES = ['received', 'developing', 'dev_done', 'deployed'] as const
export type Stage = (typeof STAGES)[number]

export const STAGE_LABEL: Record<Stage, string> = {
  received: '접수됨',
  developing: '개발 중',
  dev_done: '개발 완료',
  deployed: '배포 완료',
}

/** null = 클라이언트 목록에 노출하지 않음 (draft) */
const STATUS_TO_STAGE: Record<RequestStatus, Stage | null> = {
  draft: null,
  submitted: 'received',
  queued_exploration: 'received',
  exploring: 'received',
  awaiting_client: 'received',
  estimating: 'received',
  quote_ready: 'received',
  client_approved: 'developing',
  queued_dev: 'developing',
  developing: 'developing',
  in_review: 'dev_done',
  // manual 어댑터 대기 — 클라이언트에게는 여전히 "개발 완료"로 보인다 (§16-6)
  awaiting_manual_deploy: 'dev_done',
  deployed: 'deployed',
}

export function stageOf(status: RequestStatus): Stage | null {
  return STATUS_TO_STAGE[status]
}

export function stageIndex(stage: Stage): number {
  return STAGES.indexOf(stage)
}

/**
 * 횡단 플래그 — stage 위치를 보존한 채 얹힌다 (§7).
 * status를 덮어쓰지 않으므로 해제하면 원래 자리로 돌아온다.
 */
export const REQUEST_FLAGS = ['escalated', 'failed', 'on_hold', 'cancelled'] as const
export type RequestFlag = (typeof REQUEST_FLAGS)[number]

/**
 * 클라이언트가 움직여야 하는 상태 — 목록의 앰버 점과 "답변이 필요한 요청 N건"의 근거.
 * 관리자 대기 구간은 여기 들어가지 않는다(클라이언트는 기다리기만 하면 됨).
 */
export function isClientTurn(status: RequestStatus): boolean {
  return status === 'awaiting_client' || status === 'quote_ready' || status === 'in_review'
}

/**
 * 플래그가 붙으면 status의 문구보다 우선한다.
 * 에스컬레이션 중에 "확인 질문이 도착했어요"가 보이면 안 되기 때문이다.
 */
export const FLAG_CLIENT_NOTE: Partial<Record<RequestFlag, string>> = {
  escalated: '담당 매니저가 확인하고 있어요',
  failed: '확인 중이에요 — 잠시만 기다려주세요',
  on_hold: '보류 중이에요',
  cancelled: '취소된 요청이에요',
}

/** 한 줄 메타 문장 — 접수됨 내부의 세부 상황을 단계가 아니라 문장으로 전달한다 (§3). */
export const STATUS_CLIENT_NOTE: Record<RequestStatus, string> = {
  draft: '',
  submitted: '요청을 접수했어요',
  queued_exploration: '곧 코드를 확인할게요',
  exploring: '코드를 확인하고 있어요 — 잠시 후 질문 또는 견적이 도착합니다',
  awaiting_client: '확인 질문이 도착했어요',
  estimating: '답변을 반영해 확정 견적을 계산하고 있어요',
  quote_ready: '견적이 확정 대기 중이에요 — 승인하면 개발이 시작됩니다',
  client_approved: '담당 매니저가 검토하고 있어요',
  queued_dev: '개발 대기 중이에요',
  developing: '개발이 진행 중이에요',
  in_review: '미리보기를 확인해주세요 — 확인 후 배포됩니다',
  awaiting_manual_deploy: '배포를 준비하고 있어요',
  deployed: '배포가 완료됐어요',
}

/** 목록·스레드에 실제로 찍히는 문장. 플래그가 있으면 그쪽이 이긴다. */
export function clientNote(status: RequestStatus, flag: RequestFlag | null): string {
  if (flag && FLAG_CLIENT_NOTE[flag]) return FLAG_CLIENT_NOTE[flag]!
  return STATUS_CLIENT_NOTE[status]
}
