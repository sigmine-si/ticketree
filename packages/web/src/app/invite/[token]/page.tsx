/**
 * 초대 링크 + PIN 로그인.
 *
 * 로그인하지 않은 사람이 볼 수 있는 유일한 클라이언트 화면이다.
 * 토큰이 맞아야 PIN 폼이 열리고, PIN이 맞아야 세션이 나간다. 그 뒤로는
 * 기존 세션 레이어를 그대로 타므로 요청 목록·상세·명세는 바뀌지 않는다.
 *
 * 고정 이름이라 `/{slug}`보다 먼저 잡힌다 (주소 규약).
 */
import { redirect } from 'next/navigation'
import { clearPinFailures, findInviteByToken, recordPinFailure } from '@/lib/data'
import { isWellFormedPin, normalizePin, PIN_LENGTH, verifyPin } from '@/lib/invite'
import { setSession } from '@/lib/session'
import { clientPath } from '@/lib/routes'

export const dynamic = 'force-dynamic'

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { token } = await params
  const { error } = await searchParams
  const invite = await findInviteByToken(token)

  // 없는 토큰과 잠긴 토큰을 같은 문장으로 덮지 않는다 — 잠긴 사람은 무엇을
  // 요청해야 하는지 알아야 한다. 대신 어느 쪽이든 여기서 더 나아가지 못한다.
  if (!invite) {
    return (
      <Notice
        title="유효하지 않은 링크예요"
        body="링크가 더 이상 열리지 않거나 이미 새로 발급된 것 같아요. 담당자에게 새 초대 링크를 요청해주세요."
      />
    )
  }

  if (invite.attemptsLeft === 0) {
    return (
      <Notice
        title="이 링크는 잠겼어요"
        body={`PIN을 ${PIN_LENGTH}자리로 여러 번 잘못 입력해서 잠겼어요. 담당자에게 초대 링크와 PIN을 다시 발급해달라고 요청해주세요.`}
      />
    )
  }

  async function submit(formData: FormData) {
    'use server'
    // 화면을 그릴 때 읽은 상태는 이미 낡았을 수 있다 — 잠금 판정은 지금 다시 읽는다
    const target = await findInviteByToken(token)
    if (!target || target.attemptsLeft === 0) redirect(clientPath.invite(token))

    const pin = normalizePin(String(formData.get('pin') ?? ''))

    // 형식이 틀린 입력도 실패로 센다. 안 그러면 형식 검사를 우회해 무한히 두드릴 수 있다.
    if (!isWellFormedPin(pin) || !verifyPin(pin, target.pinHash)) {
      await recordPinFailure(target.userId)
      redirect(`${clientPath.invite(token)}?error=invalid`)
    }

    await clearPinFailures(target.userId)
    await setSession({
      userId: target.userId,
      projectId: target.projectId,
      kind: 'client',
      name: target.name,
    })
    redirect(clientPath.requests(target.slug))
  }

  // 남은 횟수는 주소가 아니라 방금 읽은 DB 값이다 — 주소로는 잠금을 못 흔든다
  const remaining = error === 'invalid' ? invite.attemptsLeft : null

  return (
    <main className="wrap" style={{ maxWidth: 420 }}>
      <div className="page-head">
        <div>
          <h1>{invite.projectName}</h1>
          <p className="sub">
            {invite.name}님, 전달받은 {PIN_LENGTH}자리 PIN을 입력해주세요
          </p>
        </div>
      </div>

      {remaining !== null && (
        <div className="callout" style={{ marginBottom: 14 }}>
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
            <path d="M12 9v4M12 17h.01" />
            <circle cx="12" cy="12" r="9" />
          </svg>
          {/* 남은 시도가 0이면 위에서 이미 잠금 화면으로 갈렸다 */}
          <div>PIN이 맞지 않아요. {remaining}번 더 틀리면 이 링크는 잠겨요.</div>
        </div>
      )}

      <div className="card">
        <form action={submit}>
          <div className="mfield">
            <label htmlFor="pin">PIN</label>
            <input
              id="pin"
              name="pin"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={PIN_LENGTH + 2}
              placeholder={'0'.repeat(PIN_LENGTH)}
              autoFocus
              required
            />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
            들어가기
          </button>
        </form>
      </div>
    </main>
  )
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <main className="wrap" style={{ maxWidth: 420 }}>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="card">
        <p className="body">{body}</p>
      </div>
    </main>
  )
}
