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
