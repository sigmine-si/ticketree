/**
 * DB 스키마 — spec.md §9 + §16
 *
 * 원칙: 상태는 DB, 진실은 Git. 이 스키마는 워크플로우 상태만 담고
 * 코드·Spec 본문은 담지 않는다(그건 GitHub에 있다).
 */
import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

// ─────────────────────────────── 프로젝트와 저장소

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  clientName: text('client_name').notNull(),
  /** provisioning | active | paused | archived */
  status: text('status').notNull().default('provisioning'),
  /** org/cafe-app-hub */
  hubRepo: text('hub_repo'),
  /** /srv/ticketree/workspaces/cafe-app-hub */
  workspacePath: text('workspace_path'),
  /** vercel | manual */
  deployAdapter: text('deploy_adapter').notNull().default('manual'),
  /** stall_alert_after, lane 상한, models 오버라이드 */
  settings: jsonb('settings').notNull().default(sql`'{}'::jsonb`),
  /** §16-4 채번 카운터. max(req_no)+1은 경합에서 깨지므로 쓰지 않는다. */
  nextReqNo: integer('next_req_no').notNull().default(1),
  createdAt,
})

export const repos = pgTable('repos', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  /** api, web */
  name: text('name').notNull(),
  githubFullName: text('github_full_name').notNull(),
  role: text('role'),
  deployOrder: integer('deploy_order').notNull().default(0),
  deployAdapter: text('deploy_adapter'),
  createdAt,
})

// ─────────────────────────────── 사용자 (§16-1)

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** admin은 NULL */
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    /** client | admin */
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    // client 전용 — 초대링크 + PIN
    inviteTokenHash: text('invite_token_hash'),
    pinHash: text('pin_hash'),
    /** 초대 링크를 마지막으로 발급한 시각. 관리자 화면이 "발급됨"을 보여주는 근거다. */
    inviteIssuedAt: timestamp('invite_issued_at', { withTimezone: true }),
    /**
     * PIN 연속 실패 횟수. 5가 되면 잠긴다 (specs/features/client-login.md).
     * 인메모리가 아니라 DB에 두는 이유 — 프로세스가 재시작해도 잠금이 풀리면
     * "관리자가 다시 발급해야만 풀린다"가 거짓이 된다.
     */
    pinFailedCount: integer('pin_failed_count').notNull().default(0),
    // admin 전용 — GitHub OAuth
    githubLogin: text('github_login'),
    githubId: bigint('github_id', { mode: 'number' }),
    createdAt,
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_github_id_idx').on(t.githubId),
    // 초대 링크 조회는 해시로 한다. unique라 토큰 충돌도 DB가 막는다.
    uniqueIndex('users_invite_token_idx').on(t.inviteTokenHash),
    index('users_project_idx').on(t.projectId),
  ],
)

// ─────────────────────────────── 변경 요청 (티켓)

export const changeRequests = pgTable(
  'change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** 프로젝트 내 일련번호. draft 단계에서는 NULL — 확정 시 채번한다. */
    reqNo: integer('req_no'),
    /** 제출 시 LLM이 자동 생성 (§4) */
    title: text('title'),
    asIs: text('as_is'),
    toBe: text('to_be').notNull(),
    /** urgent | this_week | relaxed */
    urgency: text('urgency'),
    status: text('status').notNull().default('draft'),
    /** escalated | failed | on_hold | cancelled — status를 덮지 않고 얹힌다 */
    flag: text('flag'),
    flagFromStatus: text('flag_from_status'),
    /** 앰버 플래그. isClientTurn()의 결과를 비정규화해 목록 쿼리를 단순하게 유지. */
    yourTurn: boolean('your_turn').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt,
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    deployedAt: timestamp('deployed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('change_requests_project_req_no_idx').on(t.projectId, t.reqNo),
    index('change_requests_project_status_idx').on(t.projectId, t.status),
  ],
)

// ─────────────────────────────── 접수 대화

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => changeRequests.id, { onDelete: 'cascade' }),
    round: integer('round').notNull().default(0),
    /** client | agent | system */
    role: text('role').notNull(),
    content: text('content').notNull(),
    /** agent 메시지의 구조화 결과(IntakeResult). UI가 이걸로 카드를 렌더한다. */
    payload: jsonb('payload'),
    createdAt,
  },
  (t) => [index('messages_request_idx').on(t.requestId, t.createdAt)],
)

/** §16-2 — 목업의 "1/2 답변됨"이 이 테이블의 집계다. */
export const messageQuestions = pgTable(
  'message_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    prompt: text('prompt').notNull(),
    hint: text('hint'),
    /** choice | free | choice_or_free */
    kind: text('kind').notNull().default('choice_or_free'),
    options: jsonb('options').notNull().default(sql`'[]'::jsonb`),
    answerText: text('answer_text'),
    answerOptionIdx: integer('answer_option_idx'),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('message_questions_message_idx_idx').on(t.messageId, t.idx)],
)

/** §16-3 — 에이전트에게는 추출된 텍스트만 전달한다. */
export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id')
    .notNull()
    .references(() => changeRequests.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
  filename: text('filename').notNull(),
  contentType: text('content_type'),
  byteSize: bigint('byte_size', { mode: 'number' }),
  s3Key: text('s3_key').notNull(),
  /** 텍스트 추출 결과. 이미지 등 추출 불가면 NULL이고 컨텍스트에 넣지 않는다. */
  extractedText: text('extracted_text'),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  createdAt,
})

export const agentSessions = pgTable('agent_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id')
    .notNull()
    .references(() => changeRequests.id, { onDelete: 'cascade' }),
  /** resume에는 session_id와 cwd가 둘 다 필요하다 (§4) */
  sessionId: text('session_id').notNull(),
  cwd: text('cwd').notNull(),
  /** intake | implementation */
  kind: text('kind').notNull(),
  tokenTotal: bigint('token_total', { mode: 'number' }).notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  lastResumedAt: timestamp('last_resumed_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
})

// ─────────────────────────────── job 큐

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id').references(() => changeRequests.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** chat | work — LANE_OF_JOB에서 파생, 러너가 정책을 고를 때 쓴다 */
    lane: text('lane').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('queued'),
    claimedBy: text('claimed_by'),
    worktreePath: text('worktree_path'),
    sessionRef: uuid('session_ref').references(() => agentSessions.id, { onDelete: 'set null' }),
    /** 버퍼링 상태 문구 — 에이전트 스트림에서 파생, SSE가 이걸 릴레이한다 (§2) */
    statusText: text('status_text'),
    /** 실제 실행된 모델. 원가 분석과 폴백 감지에 쓴다 (§8) */
    model: text('model'),
    attempt: integer('attempt').notNull().default(0),
    tokensIn: bigint('tokens_in', { mode: 'number' }).notNull().default(0),
    tokensOut: bigint('tokens_out', { mode: 'number' }).notNull().default(0),
    /** §8 — 구독 인증에서도 나온다. API 환산가이지 실지출은 아니다. */
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
    result: jsonb('result'),
    error: text('error'),
    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('jobs_claim_idx').on(t.status, t.queuedAt),
    index('jobs_request_idx').on(t.requestId),
  ],
)

// ─────────────────────────────── 견적

export const estimates = pgTable('estimates', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id')
    .notNull()
    .references(() => changeRequests.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(1),
  /** 러프 견적 범위 (원) — 접수 대화 확정 시점 */
  roughMin: integer('rough_min'),
  roughMax: integer('rough_max'),
  /** AI 확정 제안가 */
  proposedAmount: integer('proposed_amount'),
  /** 관리자 조정 확정가 */
  finalAmount: integer('final_amount'),
  estimatedDays: text('estimated_days'),
  costEstimateTokens: bigint('cost_estimate_tokens', { mode: 'number' }),
  /** 작업 분해 */
  wbs: jsonb('wbs').notNull().default(sql`'[]'::jsonb`),
  clientApprovedAt: timestamp('client_approved_at', { withTimezone: true }),
  adminId: uuid('admin_id').references(() => users.id),
  createdAt,
})

// ─────────────────────────────── Spec과 PR

export const specVersions = pgTable('spec_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  /** coupon */
  feature: text('feature').notNull(),
  version: text('version').notNull(),
  requestId: uuid('request_id').references(() => changeRequests.id, { onDelete: 'set null' }),
  hubPr: integer('hub_pr'),
  /** proposed | merged | rejected */
  status: text('status').notNull().default('proposed'),
  summary: text('summary'),
  mergedAt: timestamp('merged_at', { withTimezone: true }),
  createdAt,
})

export const pullRequests = pgTable('pull_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id')
    .notNull()
    .references(() => changeRequests.id, { onDelete: 'cascade' }),
  /** NULL이면 허브(Spec) PR */
  repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'set null' }),
  /** spec | code */
  kind: text('kind').notNull(),
  prNumber: integer('pr_number').notNull(),
  status: text('status').notNull().default('open'),
  headSha: text('head_sha'),
  branch: text('branch'),
  /** PR 생성 시점에 잡아둔 diff. 검토 화면이 GitHub을 다시 부르지 않게 한다. */
  diff: text('diff'),
  /** manual 어댑터면 운영자가 직접 입력 (§16-6) */
  previewUrl: text('preview_url'),
  mergedAt: timestamp('merged_at', { withTimezone: true }),
  createdAt,
})

// ─────────────────────────────── 이벤트 로그

/** 클라이언트 타임라인·감사 추적·단계별 소요 시간 분석이 전부 여기서 나온다 (§7). */
export const requestEvents = pgTable(
  'request_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => changeRequests.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    /** client | admin | agent | system */
    actorKind: text('actor_kind').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    meta: jsonb('meta').notNull().default(sql`'{}'::jsonb`),
    createdAt,
  },
  (t) => [index('request_events_request_idx').on(t.requestId, t.id)],
)

/** §11 — 수동 알림 큐. 자동 발송 채널은 두지 않는다. */
export const pendingNotices = pgTable('pending_notices', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id')
    .notNull()
    .references(() => changeRequests.id, { onDelete: 'cascade' }),
  /** question_arrived | quote_ready | preview_ready | deployed | manual_deploy_required */
  type: text('type').notNull(),
  createdAt,
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
})

// ─────────────────────────────── relations

export const projectsRel = relations(projects, ({ many }) => ({
  repos: many(repos),
  requests: many(changeRequests),
}))

export const changeRequestsRel = relations(changeRequests, ({ one, many }) => ({
  project: one(projects, { fields: [changeRequests.projectId], references: [projects.id] }),
  messages: many(messages),
  jobs: many(jobs),
  estimates: many(estimates),
}))

export const messagesRel = relations(messages, ({ one, many }) => ({
  request: one(changeRequests, { fields: [messages.requestId], references: [changeRequests.id] }),
  questions: many(messageQuestions),
}))

export const messageQuestionsRel = relations(messageQuestions, ({ one }) => ({
  message: one(messages, { fields: [messageQuestions.messageId], references: [messages.id] }),
}))
