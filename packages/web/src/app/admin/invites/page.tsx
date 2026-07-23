/**
 * 고객 계정 — 초대 링크·PIN 발급 (specs/features/client-login.md)
 *
 * 발송은 하지 않는다. 관리자가 복사해 직접 전달한다 (§11 정책).
 */
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { ledger, listClientAccounts, noticeItems } from '@/lib/admin'
import { AdminTopBar } from '@/components/AdminTopBar'
import { InviteIssuer } from '@/components/InviteIssuer'

export const dynamic = 'force-dynamic'

export default async function AdminInvites() {
  const session = await getSession()
  if (session?.kind !== 'admin') redirect('/admin/login')

  const [accounts, l, notices] = await Promise.all([listClientAccounts(), ledger(), noticeItems()])

  return (
    <>
      <AdminTopBar
        userName={session.name}
        running={l.running}
        queued={l.queued}
        notices={notices}
        current="invites"
      />
      <main className="wrap admin">
        <div className="page-head">
          <div>
            <h1>고객 계정</h1>
            <p className="sub">초대 링크와 PIN을 발급해 직접 전달해요 — 자동 발송은 하지 않아요</p>
          </div>
        </div>

        <InviteIssuer
          accounts={accounts.map((a) => ({ ...a, issuedAt: a.issuedAt?.toISOString() ?? null }))}
        />
      </main>
    </>
  )
}
