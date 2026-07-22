'use client'

/**
 * 배포 승인 / 배포 완료 표시 — spec.md §5, §16-6
 *
 * in_review              → 코드 PR을 검토하고 배포를 승인한다
 * awaiting_manual_deploy → 운영자가 직접 배포한 뒤 완료로 표시한다
 *
 * 승인 버튼 아래에는 버튼이 일으키는 비가역적 동작을 명시한다.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function DeployActions({
  requestId,
  stage,
  prNumber,
  previewUrl,
}: {
  requestId: string
  stage: 'in_review' | 'awaiting_manual_deploy'
  prNumber: number | null
  previewUrl: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState(previewUrl ?? '')

  async function call(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/admin/requests/${requestId}/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(false)
    if (!res.ok) {
      setError(((await res.json()) as { error?: string }).error ?? '처리하지 못했어요')
      return false
    }
    return true
  }

  async function savePreview() {
    if (!/^https?:\/\//.test(preview)) {
      setError('http로 시작하는 주소를 입력해주세요')
      return
    }
    if (await call({ action: 'set_preview', previewUrl: preview })) router.refresh()
  }

  async function approve() {
    if (await call({ action: 'approve' })) {
      router.push('/admin')
      router.refresh()
    }
  }

  async function markDone() {
    if (await call({ action: 'mark_done' })) {
      router.push('/admin')
      router.refresh()
    }
  }

  return (
    <div className="card">
      <p className="ch">{stage === 'in_review' ? '배포 승인' : '수동 배포 완료'}</p>

      {stage === 'in_review' ? (
        <>
          <p className="cs">코드 PR을 확인하고 미리보기를 검증한 뒤 배포를 승인해요</p>

          {/* manual 어댑터는 미리보기 URL을 운영자가 직접 넣는다 (§16-6) */}
          <div className="price-edit" style={{ marginTop: 0 }}>
            <input
              value={preview}
              onChange={(e) => setPreview(e.target.value)}
              placeholder="미리보기 URL (선택)"
              style={{ fontFamily: 'var(--sans)', textAlign: 'left' }}
            />
            <button className="btn" disabled={busy} onClick={() => void savePreview()}>
              저장
            </button>
          </div>
          {previewUrl && (
            <p className="margin-note">
              <a href={previewUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--green)' }}>
                미리보기 열기 ↗
              </a>
            </p>
          )}

          {error && <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{error}</p>}

          <div className="side-actions">
            <button
              className="btn btn-primary"
              disabled={busy || prNumber === null}
              onClick={() => void approve()}
            >
              배포 승인
            </button>
            <p className="approve-note">
              {prNumber === null
                ? '코드 PR이 준비되면 승인할 수 있어요'
                : `승인하면 PR #${prNumber}가 머지됩니다. manual 배포라 그 뒤 실제 배포는 운영자가 진행해요`}
            </p>
          </div>
        </>
      ) : (
        <>
          <p className="cs">
            코드는 이미 머지됐어요. 실제 배포를 마쳤다면 완료로 표시하세요 — 명세의 예정 항목이
            정식으로 반영됩니다.
          </p>
          {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}
          <div className="side-actions">
            <button className="btn btn-primary" disabled={busy} onClick={() => void markDone()}>
              배포 완료로 표시
            </button>
            <p className="approve-note">
              누르면 명세의 <span className="ftag">예정</span> 항목이 정식 항목으로 바뀌고 요청이
              종결됩니다
            </p>
          </div>
        </>
      )}
    </div>
  )
}
