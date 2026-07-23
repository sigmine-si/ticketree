/**
 * 상태 머신 — spec.md §7, §16-7
 *
 * 내부 status와 클라이언트에게 보이는 stage를 분리한다.
 * 관리자 Spec 승인 대기 구간은 클라이언트에게 "개발 중"으로 보인다.
 */
import type { RequestKind } from './kind'

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
  /**
   * 과업내용서 전용 종결 — 명세가 머지되어 계약이 발효됐다.
   * `deployed`로 대신하지 않는 이유: 클라이언트에게 "배포가 완료됐어요"가 나가고,
   * 2차 계약 시점에 "지금 발효 중인 계약"을 찾을 수 없다. 범위 판정이 이걸 마커로 쓴다.
   */
  'sow_active',
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
  // 과업내용서는 4단계 트랙에 올리지 않는다 — 단어가 하나도 안 맞는다. SOW_STAGES가 따로 있다.
  sow_active: null,
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
  queued_exploration: '곧 확인을 시작할게요',
  exploring: '요청 내용을 확정하기 위해 살펴보고 있어요 — 잠시 후 질문 또는 견적이 도착합니다',
  awaiting_client: '확인 질문이 도착했어요',
  estimating: '답변을 반영해 확정 견적을 계산하고 있어요',
  quote_ready: '견적이 확정 대기 중이에요 — 승인하면 개발이 시작됩니다',
  client_approved: '담당 매니저가 검토하고 있어요',
  queued_dev: '개발 대기 중이에요',
  developing: '개발이 진행 중이에요',
  in_review: '미리보기를 확인해주세요 — 확인 후 배포됩니다',
  awaiting_manual_deploy: '배포를 준비하고 있어요',
  deployed: '배포가 완료됐어요',
  sow_active: '과업내용서가 확정됐어요',
}

// ─────────────────────────────── 과업내용서

/**
 * 과업내용서의 단계.
 *
 * `stageOf`에 kind를 붙이는 대신 표를 하나 더 두는 이유가 둘이다.
 * 하나 — 4단계(접수됨·개발 중·개발 완료·배포 완료)와 단어가 하나도 안 겹쳐 공용
 * 트랙은 거짓말이 된다. 둘 — stageOf를 부르는 세 곳은 영원히 kind='change'만 본다.
 */
export const SOW_STAGES = ['drafting', 'reviewing', 'active'] as const
export type SowStage = (typeof SOW_STAGES)[number]

export const SOW_STAGE_LABEL: Record<SowStage, string> = {
  drafting: '작성 중',
  reviewing: '검토 중',
  active: '계약 발효',
}

const SOW_STATUS_TO_STAGE: Partial<Record<RequestStatus, SowStage>> = {
  draft: 'drafting',
  exploring: 'drafting',
  awaiting_client: 'drafting',
  submitted: 'reviewing',
  /**
   * 이름은 "클라이언트 승인"이지만 실제 의미는 **관리자 Spec 승인 대기**다.
   * decisionOf가 그렇게 정의하고, 과업내용서도 정확히 그 자리를 지난다.
   * 여기서 status를 새로 만들면 decide 라우트의 가드와 decisionOf를 둘 다 고쳐야 한다.
   */
  client_approved: 'reviewing',
  sow_active: 'active',
}

export function sowStageOf(status: RequestStatus): SowStage | null {
  return SOW_STATUS_TO_STAGE[status] ?? null
}

/**
 * 과업내용서에서만 다르게 말해야 하는 문장.
 * Record를 통째로 복제하지 않고 얹는다 — 복제하면 한쪽만 고쳐져 어긋난다.
 */
export const SOW_CLIENT_NOTE: Partial<Record<RequestStatus, string>> = {
  submitted: '과업내용서를 확정했어요 — 명세 초안을 만들고 있어요',
  client_approved: '담당 매니저가 과업내용서를 검토하고 있어요',
  sow_active: '과업내용서가 확정됐어요 — 이제 요청을 보내주세요',
}

/** 목록·스레드에 실제로 찍히는 문장. 플래그가 있으면 그쪽이 이긴다. */
export function clientNote(
  status: RequestStatus,
  flag: RequestFlag | null,
  kind: RequestKind = 'change',
): string {
  if (flag && FLAG_CLIENT_NOTE[flag]) return FLAG_CLIENT_NOTE[flag]!
  if (kind === 'sow') return SOW_CLIENT_NOTE[status] ?? STATUS_CLIENT_NOTE[status]
  return STATUS_CLIENT_NOTE[status]
}
