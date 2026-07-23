/**
 * 초대 토큰과 PIN
 *
 * 순수 암호 유틸이다. DB도 쿠키도 모른다 — 저장은 lib/admin.ts(발급)와
 * lib/data.ts(검증)가 한다.
 *
 * 새 의존성을 두지 않고 node:crypto만 쓴다. 토큰은 256비트 난수라 추측이
 * 불가능하므로 조회 가능한 SHA-256으로 해시하고, PIN은 6자리(백만 가지)뿐이라
 * 유출된 DB에서 바로 역산되지 않도록 salt + scrypt로 늘린다.
 */
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto'

/** 연속 실패 한도. 이 횟수를 채우면 잠기고, 재발급 말고는 풀리지 않는다. */
export const MAX_PIN_ATTEMPTS = 5

/** PIN은 숫자 6자리다 (구현 규칙). */
export const PIN_LENGTH = 6

const SCRYPT_KEYLEN = 32

/** URL에 그대로 들어가는 초대 토큰. 평문은 발급 응답에서 딱 한 번 나간다. */
export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url')
}

/** 앞자리가 0이어도 6자리를 유지한다 — 자릿수가 흔들리면 입력 폼이 거짓말을 한다. */
export function generatePin(): string {
  return String(randomInt(0, 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, '0')
}

/**
 * 토큰 해시. 조회에 써야 하므로 salt 없는 결정적 해시다.
 * 토큰 자체가 고엔트로피라 사전 공격이 성립하지 않는다.
 */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** `scrypt$<salt>$<key>` — 알고리즘을 문자열에 박아둬야 나중에 바꿀 때 구분된다. */
export function hashPin(pin: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(pin, salt, SCRYPT_KEYLEN)
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`
}

export function verifyPin(pin: string, stored: string | null): boolean {
  if (!stored) return false
  const [algo, saltPart, keyPart] = stored.split('$')
  if (algo !== 'scrypt' || !saltPart || !keyPart) return false

  const expected = Buffer.from(keyPart, 'base64url')
  let actual: Buffer
  try {
    actual = scryptSync(pin, Buffer.from(saltPart, 'base64url'), expected.length)
  } catch {
    return false
  }
  return timingSafeEqual(actual, expected)
}

/** 입력값 정규화 — 공백이나 하이픈을 넣어도 통과시킨다. 그 외 문자는 거른다. */
export function normalizePin(raw: string): string {
  return raw.replace(/[\s-]/g, '')
}

export function isWellFormedPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)
}
