'use client'

/**
 * 고객 계정별 초대 링크·PIN 발급 — specs/features/client-login.md
 *
 * 평문은 발급 응답에만 실려 오고 저장되지 않는다. 그래서 이 화면은 "닫으면
 * 다시 볼 수 없다"를 말로만 하지 않고, 새로고침하면 실제로 사라지게 둔다.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface AccountRow {
  userId: string
  name: string
  projectName: string
  slug: string
  issuedAt: string | null
  locked: boolean
  attemptsLeft: number
}

interface Issued {
  url: string
  pin: string
}

export function InviteIssuer({ accounts }: { accounts: AccountRow[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [issued, setIssued] = useState<Record<string, Issued>>({})
  const [error, setError] = useState<string | null>(null)

  async function issue(userId: string) {
    setBusy(userId)
    setError(null)
    const res = await fetch(`/api/admin/users/${userId}/invite`, { method: 'POST' })
    setBusy(null)
    if (!res.ok) {
      setError(((await res.json()) as { error?: string }).error ?? '발급하지 못했어요')
      return
    }
    const data = (await res.json()) as Issued
    setIssued((prev) => ({ ...prev, [userId]: data }))
    router.refresh()
  }

  if (accounts.length === 0) {
    return (
      <div className="card">
        <p className="body">고객 계정이 아직 없어요.</p>
      </div>
    )
  }

  return (
    <>
      {error && (
        <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {accounts.map((a) => {
          const fresh = issued[a.userId]
          return (
            <div className="card" key={a.userId}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <p className="ch">
                    {a.name}
                    <span style={{ color: 'var(--faint)', fontWeight: 400, marginLeft: 8 }}>
                      {a.projectName}
                    </span>
                  </p>
                  <p className="cs" style={{ marginBottom: 0 }}>
                    {a.locked
                      ? 'PIN 5회 실패로 잠김 — 다시 발급해야 풀려요'
                      : a.issuedAt
                        ? `${new Date(a.issuedAt).toLocaleString('ko-KR')} 발급 · 남은 시도 ${a.attemptsLeft}회`
                        : '아직 발급하지 않았어요'}
                  </p>
                </div>
                <button
                  className="btn btn-primary"
                  disabled={busy !== null}
                  onClick={() => void issue(a.userId)}
                >
                  {a.issuedAt || a.locked ? '다시 발급' : '초대 링크 생성'}
                </button>
              </div>

              {fresh && (
                <div className="callout" style={{ marginTop: 14 }}>
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                    <path d="M12 9v4M12 17h.01" />
                    <circle cx="12" cy="12" r="9" />
                  </svg>
                  <div style={{ minWidth: 0 }}>
                    <span className="ct">지금 한 번만 보여요</span>
                    <br />
                    링크와 PIN을 복사해 클라이언트에게 직접 전달해주세요. 이 화면을 벗어나면
                    다시 볼 수 없고, 다시 발급하면 이 링크는 무효가 됩니다.
                    <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                      <code style={{ wordBreak: 'break-all' }}>{fresh.url}</code>
                      <code>
                        PIN <strong>{fresh.pin}</strong>
                      </code>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
