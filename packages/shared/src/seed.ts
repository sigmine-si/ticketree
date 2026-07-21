/**
 * 개발용 시드 — 허브 워크스페이스와 DB 행을 만든다.
 *
 * 슬라이스 1을 실제로 시험하려면 에이전트가 탐색할 진짜 코드가 있어야 한다.
 * 목업에 나오는 "카페 주문 앱"을 그대로 만든다.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createDb, closeDb } from './db/client.js'
import { projects, repos, users } from './db/schema.js'
import { eq } from 'drizzle-orm'

const ROOT = resolve(process.cwd(), '../..')
const HUB = join(ROOT, 'workspaces', 'cafe-app-hub')

function write(rel: string, content: string): void {
  const path = join(HUB, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content.trimStart())
}

// ─────────────────────────────── 허브 repo (§6)

const CLAUDE_MD = `
# 카페 주문 앱 — 허브

## 플랫폼 규칙 (모든 프로젝트 공통)

- \`specs/features/*.md\`가 유일한 진실이다. 코드가 명세와 다르면 그 차이를 보고하라.
- 이 워크스페이스에서 main 브랜치에 직접 push하지 않는다.
- 명세와 요청이 충돌하면 추측해서 진행하지 말고 멈추고 보고하라.
- 탐색 결과는 파일 경로와 함께 보고한다.

## 이 프로젝트

카페 매장의 모바일 주문 앱. 손님이 앱으로 음료를 주문·결제하고, 스탬프를 적립한다.

- \`repos/web\` — 손님용 앱 + 주문·결제·적립 로직 (단일 repo)
`

const REPOS_YML = `
repos:
  - name: web
    github: sigmine-si/cafe-app-web
    role: 손님용 주문 앱
    deploy_order: 1
    deploy_adapter: manual
`

const SPEC_COUPON = `
# 쿠폰·적립

버전: v1.2 · 마지막 변경 2026-07-12 (REQ-008)

## 이렇게 동작해요

- 회원이 음료를 주문하면 결제 완료 시점에 스탬프가 1개 적립된다
- 적립 현황은 주문 완료 화면과 마이페이지에서 확인할 수 있다
- 주문 취소·환불 시 해당 주문으로 적립된 스탬프는 회수된다

## 변경 이력

- v1.2 (REQ-008) 취소·환불 시 스탬프 회수 규칙 추가
- v1.1 (REQ-005) 마이페이지 적립 현황 표시 추가
- v1.0 (REQ-003) 스탬프 적립 기능 최초 정의
`

const SPEC_ORDER = `
# 주문

버전: v2.0 · 마지막 변경 2026-06-28 (REQ-006)

## 이렇게 동작해요

- 회원은 메뉴에서 음료를 골라 장바구니에 담고 한 번에 주문한다
- 주문 시 매장 픽업 또는 매장 식사를 선택한다
- 결제가 완료되어야 주문이 매장에 전달된다
- 주문 상태는 접수 → 준비 중 → 준비 완료 순으로 바뀐다
- 손님은 주문 내역 화면에서 현재 상태를 확인할 수 있다

## 알려진 제약

- 준비 완료 시 손님에게 능동적으로 알리는 수단은 없다 (화면을 직접 봐야 한다)
`

const DIGEST_WEB = `
# repos/web — 코드 지도

## 구조

- \`src/orders/checkout.ts\` — 주문 생성과 결제 요청. 장바구니를 주문으로 바꾼다.
- \`src/orders/status.ts\` — 주문 상태 전이(접수/준비 중/준비 완료).
- \`src/billing/PriceCalculator.ts\` — 금액 계산. 할인 로직이 전부 여기 모여 있다.
- \`src/billing/webhook.ts\` — PG사 결제 완료 웹훅 수신. 결제 확정의 단일 지점.
- \`src/loyalty/stamps.ts\` — 스탬프 적립·회수.
- \`src/notify/push.ts\` — 푸시 발송 모듈. **현재 비활성(ENABLED=false)**.

## 주의

- 결제 확정은 반드시 webhook.ts를 거친다. checkout.ts의 응답은 결제 완료를 보장하지 않는다.
- 할인 계산을 PriceCalculator 밖에서 하지 않는다.
`

const CODE: Record<string, string> = {
  'repos/web/src/orders/checkout.ts': `
import { PriceCalculator } from '../billing/PriceCalculator.js'
import type { Cart, Order } from './types.js'

/**
 * 장바구니를 주문으로 바꾸고 결제를 요청한다.
 * 주의: 여기서 성공이 떨어져도 결제 확정은 아니다 — billing/webhook.ts가 확정한다.
 */
export async function createOrder(cart: Cart, memberId: string): Promise<Order> {
  const price = new PriceCalculator().calculate(cart)
  const order = await db.orders.insert({
    memberId,
    items: cart.items,
    amount: price.total,
    discount: price.discount,
    status: 'pending_payment',
  })
  await pg.requestPayment({ orderId: order.id, amount: price.total })
  return order
}
`,
  'repos/web/src/orders/status.ts': `
import type { Order } from './types.js'

export type OrderStatus = 'accepted' | 'preparing' | 'ready'

const NEXT: Record<OrderStatus, OrderStatus | null> = {
  accepted: 'preparing',
  preparing: 'ready',
  ready: null,
}

/** 매장 태블릿에서 호출한다. 손님에게 알리는 동작은 아직 없다. */
export async function advance(order: Order): Promise<OrderStatus> {
  const next = NEXT[order.status as OrderStatus]
  if (!next) throw new Error('already ready')
  await db.orders.update(order.id, { status: next })
  return next
}
`,
  'repos/web/src/billing/PriceCalculator.ts': `
import type { Cart } from '../orders/types.js'

export interface PriceResult {
  subtotal: number
  discount: number
  total: number
}

/**
 * 금액 계산의 단일 지점. 할인은 전부 여기서 처리한다.
 * 새로운 할인 수단(쿠폰 등)을 붙일 자리도 여기다.
 */
export class PriceCalculator {
  calculate(cart: Cart): PriceResult {
    const subtotal = cart.items.reduce((s, i) => s + i.price * i.qty, 0)
    const discount = this.memberDiscount(cart)
    return { subtotal, discount, total: subtotal - discount }
  }

  private memberDiscount(cart: Cart): number {
    return cart.memberTier === 'vip' ? Math.floor(cart.items.length * 200) : 0
  }
}
`,
  'repos/web/src/billing/webhook.ts': `
import { grantStamp } from '../loyalty/stamps.js'

/**
 * PG사 결제 완료 웹훅. 결제 확정의 단일 지점이다.
 * 적립·정산 등 "결제가 끝난 뒤" 일어나야 하는 일은 전부 여기에 건다.
 */
export async function onPaymentConfirmed(payload: { orderId: string }): Promise<void> {
  const order = await db.orders.get(payload.orderId)
  if (order.status !== 'pending_payment') return // 중복 웹훅 방어

  await db.orders.update(order.id, { status: 'accepted' })
  await grantStamp(order.memberId, order.id, order.items.length)
}
`,
  'repos/web/src/loyalty/stamps.ts': `
/** 스탬프 적립·회수. 쿠폰 발급은 아직 없다. */
export async function grantStamp(
  memberId: string,
  orderId: string,
  count: number,
): Promise<void> {
  await db.stamps.insert({ memberId, orderId, count })
}

/** 주문 취소·환불 시 해당 주문의 스탬프를 회수한다 (spec v1.2). */
export async function revokeStamp(orderId: string): Promise<void> {
  await db.stamps.deleteByOrder(orderId)
}

export async function stampCount(memberId: string): Promise<number> {
  const rows = await db.stamps.findByMember(memberId)
  return rows.reduce((s, r) => s + r.count, 0)
}
`,
  'repos/web/src/notify/push.ts': `
/**
 * 푸시 발송 모듈.
 * 현재 비활성 상태다 — 발신 설정이 끝나지 않아 꺼둔 채로 두었다.
 */
export const ENABLED = false

export async function sendPush(memberId: string, title: string, body: string): Promise<void> {
  if (!ENABLED) return
  await fcm.send({ to: await tokenOf(memberId), notification: { title, body } })
}
`,
  'repos/web/src/orders/types.ts': `
export interface CartItem {
  sku: string
  name: string
  price: number
  qty: number
}

export interface Cart {
  items: CartItem[]
  memberTier: 'basic' | 'vip'
}

export interface Order {
  id: string
  memberId: string
  items: CartItem[]
  amount: number
  status: string
}
`,
  'repos/web/CLAUDE.md': `
# repos/web

손님용 주문 앱. TypeScript.

- 결제 확정은 \`src/billing/webhook.ts\`에서만 일어난다.
- 할인 계산은 \`src/billing/PriceCalculator.ts\` 밖에서 하지 않는다.
`,
}

function writeWorkspace(): void {
  write('CLAUDE.md', CLAUDE_MD)
  write('repos.yml', REPOS_YML)
  write('specs/features/coupon.md', SPEC_COUPON)
  write('specs/features/order.md', SPEC_ORDER)
  write('digests/web.md', DIGEST_WEB)
  for (const [path, content] of Object.entries(CODE)) write(path, content)
  console.log(`workspace: ${HUB}`)
}

async function seedDb(): Promise<void> {
  const db = createDb()

  const existing = await db.select().from(projects).where(eq(projects.slug, 'cafe-app'))
  if (existing.length > 0) {
    await db
      .update(projects)
      .set({ workspacePath: HUB, status: 'active' })
      .where(eq(projects.slug, 'cafe-app'))
    console.log('project cafe-app: updated')
    await closeDb()
    return
  }

  const [project] = await db
    .insert(projects)
    .values({
      slug: 'cafe-app',
      name: '카페 주문 앱',
      clientName: '김서연',
      status: 'active',
      hubRepo: 'sigmine-si/cafe-app-hub',
      workspacePath: HUB,
      deployAdapter: 'manual',
    })
    .returning({ id: projects.id })

  await db.insert(repos).values({
    projectId: project!.id,
    name: 'web',
    githubFullName: 'sigmine-si/cafe-app-web',
    role: '손님용 주문 앱',
    deployOrder: 1,
    deployAdapter: 'manual',
  })

  await db.insert(users).values({
    projectId: project!.id,
    kind: 'client',
    name: '김서연',
  })

  console.log(`project cafe-app: created (${project!.id})`)
  await closeDb()
}

writeWorkspace()
await seedDb()
