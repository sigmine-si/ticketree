/**
 * 데모 프로젝트 시드 — 그린루프 몰
 *
 * 명세와 코드를 한 저장소에 둔다(§6, §16-12). specs/ 가 계약, src/ 가 구현.
 * 워크스페이스를 만들고 sigmine-si/greenloop-mall에 올린다.
 *
 * 이미 저장소가 있고 명세 PR 이력이 있으면 push는 건너뛴다 — 재실행해도
 * 히스토리를 덮지 않는다.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { closeDb, createDb } from './db/client'
import { projects, repos, users } from './db/schema'

const SLUG = 'greenloop-mall'
const REPO = 'sigmine-si/greenloop-mall'
const ROOT = resolve(process.cwd(), '../..')
const WS = join(ROOT, 'workspaces', SLUG)

function write(rel: string, content: string): void {
  const path = join(WS, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content.trimStart())
}

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: WS, encoding: 'utf8' }).trim()
}

// ─────────────────────────────── 저장소 파일 (명세 + 코드 한 곳)

const FILES: Record<string, string> = {
  'CLAUDE.md': `
# 그린루프 몰

중고 물건을 사고파는 온라인 마켓. 판매자가 물건을 올리고, 구매자가 사면,
구매 확정 후 판매자에게 정산금이 나간다.

명세와 코드가 한 저장소에 있다. \`specs/\` 가 계약, \`src/\` 가 구현이다.

## 플랫폼 규칙

- \`specs/features/*.md\`가 유일한 진실이다. 코드가 명세와 다르면 그 차이를 보고하라.
- main 브랜치에 직접 push하지 않는다. 변경은 반드시 브랜치와 PR로 낸다.
- 명세와 요청이 충돌하면 추측해서 진행하지 말고 멈추고 보고하라.
- **PR을 머지하지 않는다.** 머지는 사람의 승인 뒤에 러너가 한다.
- 탐색 결과는 파일 경로와 함께 보고한다.

## 명세 작성 규칙

- 클라이언트가 읽을 수 있는 말로 쓴다. 파일명·함수명·기술 용어를 쓰지 않는다.
- 수용 기준은 "무엇이 일어나는가"로 쓴다. "어떻게 구현하는가"는 digest에 둔다.
- 배포 전 항목은 \`- [ ] (예정 · REQ-014) ...\` 형식으로 적는다. 배포되면 \`- [x]\`로 바꾼다.

## 코드 규칙

- 금액 계산은 \`src/billing/fee.ts\` 밖에서 하지 않는다.
- 구매 확정은 \`src/orders/confirm.ts\`의 \`confirmPurchase\`를 거친다.
`,

  '.gitignore': `
# 구현 작업장 — worktree. 저장소에 커밋하지 않는다.
work/
.env
node_modules/
`,

  'specs/features/listing.md': `
# 상품 등록

버전: v1.1 · 마지막 변경 2026-06-30 (REQ-004)

## 이렇게 동작해요

- [x] 판매자는 사진과 함께 상품을 등록할 수 있다
- [x] 사진은 최대 10장까지 올릴 수 있다
- [x] 등록된 상품은 판매자가 언제든 내릴 수 있다
- [x] 이미 주문이 들어온 상품은 내릴 수 없다

## 변경 이력

- v1.1 (REQ-004) 주문 들어온 상품 내리기 제한 추가
- v1.0 (REQ-001) 상품 등록 최초 정의
`,

  'specs/features/order.md': `
# 주문·결제

버전: v1.3 · 마지막 변경 2026-07-08 (REQ-009)

## 이렇게 동작해요

- [x] 구매자가 상품을 주문하면 결제가 진행된다
- [x] 결제가 완료되면 판매자에게 주문이 전달된다
- [x] 구매자는 물건을 받은 뒤 구매 확정을 누른다
- [x] 구매 확정을 누르지 않아도 배송 완료 7일 뒤 자동으로 확정된다
- [x] 구매 확정 전에는 구매자가 주문을 취소할 수 있다

## 변경 이력

- v1.3 (REQ-009) 자동 구매 확정 규칙 추가
- v1.2 (REQ-006) 주문 취소 조건 명확화
- v1.0 (REQ-002) 주문·결제 최초 정의
`,

  'specs/features/settlement.md': `
# 판매자 정산

버전: v1.0 · 마지막 변경 2026-06-21 (REQ-003)

## 이렇게 동작해요

- [x] 구매 확정이 되면 판매자에게 정산금이 잡힌다
- [x] 정산금은 판매가에서 수수료 10%를 뺀 금액이다
- [x] 정산금은 구매 확정 후 3영업일에 판매자 계좌로 나간다
- [x] 정산 내역은 판매자 페이지에서 확인할 수 있다

## 변경 이력

- v1.0 (REQ-003) 정산 규칙 최초 정의
`,

  'digest.md': `
# 코드 지도

## 구조

- \`src/listing/create.ts\` — 상품 등록·내리기.
- \`src/orders/checkout.ts\` — 주문 생성과 결제 요청.
- \`src/orders/confirm.ts\` — 구매 확정과 자동 확정 배치.
- \`src/billing/fee.ts\` — 수수료 계산. 수수료 관련 로직은 전부 여기 모은다.
- \`src/settlement/payout.ts\` — 정산금 산정과 지급 예약.
- \`src/orders/types.ts\` — 주문·상품 타입.

## 주의

- 금액 계산을 \`fee.ts\` 밖에서 하지 않는다.
- 구매 확정은 \`confirm.ts\`의 \`confirmPurchase\`가 단일 지점이다.
`,

  'src/orders/types.ts': `
export interface Listing {
  id: string
  sellerId: string
  title: string
  price: number
  photos: string[]
  status: 'on_sale' | 'reserved' | 'sold' | 'taken_down'
}

export interface Order {
  id: string
  listingId: string
  buyerId: string
  sellerId: string
  amount: number
  status: 'pending_payment' | 'paid' | 'delivered' | 'confirmed' | 'cancelled'
  deliveredAt: Date | null
  confirmedAt: Date | null
}
`,

  'src/listing/create.ts': `
import type { Listing } from '../orders/types'

const MAX_PHOTOS = 10

export async function createListing(
  sellerId: string,
  input: { title: string; price: number; photos: string[] },
): Promise<Listing> {
  if (input.photos.length > MAX_PHOTOS) {
    throw new Error('사진은 최대 10장까지 올릴 수 있어요')
  }
  return db.listings.insert({ ...input, sellerId, status: 'on_sale' })
}

/** 판매자가 상품을 내린다. 주문이 걸린 상품은 내릴 수 없다 (spec v1.1). */
export async function takeDown(listingId: string): Promise<void> {
  const orders = await db.orders.findByListing(listingId)
  if (orders.length > 0) throw new Error('이미 주문이 들어온 상품이에요')
  await db.listings.update(listingId, { status: 'taken_down' })
}
`,

  'src/billing/fee.ts': `
/**
 * 수수료 계산의 단일 지점.
 * 금액과 관련된 계산은 전부 여기서 한다.
 */
export const FEE_RATE = 0.1

export function commission(amount: number): number {
  return Math.floor(amount * FEE_RATE)
}

/** 판매자가 실제로 받는 금액. */
export function sellerPayout(amount: number): number {
  return amount - commission(amount)
}
`,

  'src/orders/checkout.ts': `
import type { Listing, Order } from './types'

export async function createOrder(listing: Listing, buyerId: string): Promise<Order> {
  if (listing.status !== 'on_sale') throw new Error('판매 중인 상품이 아니에요')

  const order = await db.orders.insert({
    listingId: listing.id,
    buyerId,
    sellerId: listing.sellerId,
    amount: listing.price,
    status: 'pending_payment',
  })
  await db.listings.update(listing.id, { status: 'reserved' })
  await pg.requestPayment({ orderId: order.id, amount: listing.price })
  return order
}
`,

  'src/orders/confirm.ts': `
import { schedulePayout } from '../settlement/payout'
import type { Order } from './types'

const AUTO_CONFIRM_DAYS = 7

/** 구매 확정의 단일 지점. 정산 예약도 여기서 건다. */
export async function confirmPurchase(order: Order): Promise<void> {
  if (order.status !== 'delivered') throw new Error('배송 완료 상태가 아니에요')

  await db.orders.update(order.id, { status: 'confirmed', confirmedAt: new Date() })
  await db.listings.update(order.listingId, { status: 'sold' })
  await schedulePayout(order)
}

/** 배송 완료 후 일정 기간이 지난 주문을 자동 확정한다. 매일 새벽에 돈다. */
export async function autoConfirmBatch(): Promise<void> {
  const cutoff = new Date(Date.now() - AUTO_CONFIRM_DAYS * 86400_000)
  const orders = await db.orders.findDeliveredBefore(cutoff)
  for (const order of orders) await confirmPurchase(order)
}
`,

  'src/settlement/payout.ts': `
import { sellerPayout } from '../billing/fee'
import type { Order } from './types'

/**
 * 정산금을 잡고 지급일을 예약한다.
 * 지급은 외부 이체 시스템이 예약일에 집어간다.
 *
 * 주의: 명세는 '3영업일'이라 하지만 실제 계산은 5일 뒤(주말·공휴일 포함)다.
 * 이 불일치는 데모용으로 일부러 심어둔 것이다.
 */
const PAYOUT_DELAY_DAYS = 5

export async function schedulePayout(order: Order): Promise<void> {
  const amount = sellerPayout(order.amount)
  const payoutAt = new Date(Date.now() + PAYOUT_DELAY_DAYS * 86400_000)

  await db.payouts.insert({
    sellerId: order.sellerId,
    orderId: order.id,
    amount,
    payoutAt,
    status: 'scheduled',
  })
}

export async function sellerPayouts(sellerId: string) {
  return db.payouts.findBySeller(sellerId)
}
`,
}

function writeWorkspace(): void {
  for (const [path, content] of Object.entries(FILES)) write(path, content)
  console.log(`workspace: ${WS}`)
}

function pushRepo(): void {
  if (!existsSync(join(WS, '.git'))) {
    git('init', '-b', 'main')
    git('remote', 'add', 'origin', `https://github.com/${REPO}.git`)
  }
  git('add', '-A')
  try {
    git('commit', '-m', '초기 구성 — 명세와 코드')
  } catch {
    console.log('커밋할 변경 없음 (이미 최신)')
    return
  }
  git('push', '-u', 'origin', 'main')
  console.log(`pushed: https://github.com/${REPO}`)
}

async function seedDb(): Promise<void> {
  const db = createDb()
  const [existing] = await db.select().from(projects).where(eq(projects.slug, SLUG))

  if (existing) {
    await db
      .update(projects)
      .set({ workspacePath: WS, hubRepo: REPO, status: 'active' })
      .where(eq(projects.id, existing.id))
    console.log(`project ${SLUG}: updated`)
    await closeDb()
    return
  }

  const [project] = await db
    .insert(projects)
    .values({
      slug: SLUG,
      name: '그린루프 몰',
      clientName: '박지훈',
      status: 'active',
      hubRepo: REPO,
      workspacePath: WS,
      deployAdapter: 'manual',
    })
    .returning({ id: projects.id })

  await db.insert(repos).values({
    projectId: project!.id,
    name: 'app',
    githubFullName: REPO,
    role: '마켓 웹앱',
    deployOrder: 1,
    deployAdapter: 'manual',
  })

  await db.insert(users).values({ projectId: project!.id, kind: 'client', name: '박지훈' })
  console.log(`project ${SLUG}: created (${project!.id})`)
  await closeDb()
}

writeWorkspace()
pushRepo()
await seedDb()
