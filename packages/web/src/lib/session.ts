/**
 * 세션 — spec.md §10, §16-1
 *
 * 클라이언트: 초대링크 + PIN (초대·PIN 화면은 슬라이스 2)
 * 관리자: GitHub OAuth (슬라이스 2)
 *
 * 지금은 세션 쿠키의 서명·검증과 스코프 강제만 구현한다.
 * 로그인 수단이 무엇이든 이 아래는 바뀌지 않는다.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { loadRootEnv } from '@ticketree/shared/env'

// Next.js는 packages/web/.env 만 읽는다. 서명 키·OAuth 설정은 루트 .env에 있다.
loadRootEnv()

const COOKIE = 'tt_session'
const SECRET = process.env.SESSION_SECRET ?? 'dev-only-insecure-secret'

export interface Session {
  userId: string
  /** admin은 null — 프로젝트에 묶이지 않는다 */
  projectId: string | null
  kind: 'client' | 'admin'
  name: string
}

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('base64url')
}

export function serialize(s: Session): string {
  const payload = Buffer.from(JSON.stringify(s)).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function deserialize(raw: string): Session | null {
  const dot = raw.lastIndexOf('.')
  if (dot < 0) return null
  const payload = raw.slice(0, dot)
  const mac = raw.slice(dot + 1)

  const expected = sign(payload)
  // 길이가 다르면 timingSafeEqual이 던진다 — 먼저 막는다
  if (mac.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session
  } catch {
    return null
  }
}

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE)?.value
  return raw ? deserialize(raw) : null
}

export async function setSession(s: Session): Promise<void> {
  ;(await cookies()).set(COOKIE, serialize(s), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
}

export async function clearSession(): Promise<void> {
  ;(await cookies()).delete(COOKIE)
}

export class Unauthorized extends Error {
  constructor() {
    super('unauthorized')
    this.name = 'Unauthorized'
  }
}

/**
 * 클라이언트 세션을 요구하고 project_id를 반환한다.
 * 모든 클라이언트 조회는 반드시 이 함수가 준 projectId로 스코프된다 (§9).
 */
export async function requireClient(): Promise<Session & { projectId: string }> {
  const s = await getSession()
  if (!s || s.kind !== 'client' || !s.projectId) throw new Unauthorized()
  return s as Session & { projectId: string }
}

/**
 * 관리자 세션. 관리자는 프로젝트 스코프가 없다 — 전 프로젝트를 본다.
 * 클라이언트 세션으로는 절대 통과할 수 없다.
 */
export async function requireAdmin(): Promise<Session> {
  const s = await getSession()
  if (!s || s.kind !== 'admin') throw new Unauthorized()
  return s
}

/**
 * 로컬 개발 전용 통로(`/dev-login`)가 열려 있는가.
 *
 * 이 화면은 로컬에서 로그인 흐름 없이 DB에 들어가는 유일한 문이라 남겨둔다.
 * 대신 실제 서비스에서는 닫힌다 — 거기 들어오는 문은 초대 링크뿐이다
 * (specs/features/client-login.md).
 */
export function devLoginEnabled(): boolean {
  return process.env.NODE_ENV !== 'production'
}

/** 아이디·비밀번호 둘 다 있어야 관리자 로그인이 열린다 (§16-1). */
export function adminLoginConfigured(): boolean {
  return Boolean(process.env.ADMIN_ID && process.env.ADMIN_PASSWORD)
}

/** 길이가 달라도 던지지 않는 상수시간 비교 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHmac('sha256', SECRET).update(a).digest()
  const hb = createHmac('sha256', SECRET).update(b).digest()
  return timingSafeEqual(ha, hb)
}

/**
 * ADMIN_ID / ADMIN_PASSWORD 대조 (§16-1).
 * 둘 중 하나라도 비어 있으면 아무도 못 들어온다.
 */
export function verifyAdminCredentials(id: string, password: string): boolean {
  const expectedId = process.env.ADMIN_ID
  const expectedPassword = process.env.ADMIN_PASSWORD
  if (!expectedId || !expectedPassword) return false
  // 둘 다 비교해야 아이디 존재 여부가 응답 시간으로 새지 않는다
  const idOk = safeEqual(id, expectedId)
  const passwordOk = safeEqual(password, expectedPassword)
  return idOk && passwordOk
}
