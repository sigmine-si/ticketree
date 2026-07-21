/**
 * "필요한 결정" — spec.md §5
 *
 * DB를 건드리지 않는 순수 모듈이다. 클라이언트 컴포넌트가 이걸 import한다
 * (lib/admin은 db를 끌고 오므로 서버 전용).
 */
import type { RequestFlag, RequestStatus } from '@ticketree/shared/status'

export type Decision = 'answer' | 'spec' | 'deploy' | 'running' | 'waiting' | 'done'

export const DECISION_LABEL: Record<Decision, string> = {
  answer: '답변 필요',
  spec: 'Spec 승인',
  deploy: '배포 승인',
  running: '진행 중',
  waiting: '대기',
  done: '완료',
}

export const DECISION_TONE: Record<Decision, 'red' | 'amber' | 'gray' | 'green'> = {
  answer: 'red',
  spec: 'amber',
  deploy: 'amber',
  running: 'gray',
  waiting: 'gray',
  done: 'green',
}

/** 정렬 우선순위. 결정이 필요한 것이 위로 온다. */
export const DECISION_ORDER: Record<Decision, number> = {
  answer: 0,
  spec: 1,
  deploy: 2,
  running: 3,
  waiting: 4,
  done: 5,
}

export function decisionOf(
  status: RequestStatus,
  flag: RequestFlag | null,
  hasRunningJob: boolean,
): Decision {
  // 에이전트가 멈춰 세운 건이 가장 급하다 — 이건 아무도 대신 못 푼다
  if (flag === 'escalated') return 'answer'
  if (status === 'client_approved') return 'spec'
  if (status === 'in_review' || status === 'awaiting_manual_deploy') return 'deploy'
  if (hasRunningJob) return 'running'
  if (status === 'deployed') return 'done'
  return 'waiting'
}
