'use client'

/** 프로젝트 붙이기 — 행만 만들고 나머지는 온보딩 job이 한다 (§12). */
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function NewProject() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [f, setF] = useState({ slug: '', name: '', clientName: '', hubRepo: '' })

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value })

  async function submit() {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/admin/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(f),
    })
    setBusy(false)
    if (!res.ok) {
      setError(((await res.json()) as { error?: string }).error ?? '만들지 못했어요')
      return
    }
    setOpen(false)
    setF({ slug: '', name: '', clientName: '', hubRepo: '' })
    router.refresh()
  }

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        프로젝트 붙이기
      </button>
    )
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <p className="ch">프로젝트 붙이기</p>
      <p className="cs">
        저장소를 읽어 명세 초안을 만들고 PR을 엽니다 — 읽고 고쳐 머지해야 요청을 받을 수 있어요
      </p>
      <div className="mfield">
        <label htmlFor="np-name">이름</label>
        <input id="np-name" value={f.name} onChange={set('name')} placeholder="그린루프 몰" />
      </div>
      <div className="mfield">
        <label htmlFor="np-slug">주소</label>
        <input id="np-slug" value={f.slug} onChange={set('slug')} placeholder="greenloop-mall" />
      </div>
      <div className="mfield">
        <label htmlFor="np-client">클라이언트</label>
        <input id="np-client" value={f.clientName} onChange={set('clientName')} placeholder="박지훈" />
      </div>
      <div className="mfield">
        <label htmlFor="np-repo">저장소</label>
        <input id="np-repo" value={f.hubRepo} onChange={set('hubRepo')} placeholder="org/repo" />
      </div>
      {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}
      <div className="est-actions">
        <button className="btn" disabled={busy} onClick={() => setOpen(false)}>
          취소
        </button>
        <button
          className="btn btn-primary"
          disabled={busy || !f.slug || !f.name || !f.clientName || !f.hubRepo}
          onClick={() => void submit()}
        >
          {busy ? '만드는 중…' : '붙이고 온보딩 시작'}
        </button>
      </div>
    </div>
  )
}
