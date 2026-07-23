/**
 * 서비스 명세 — spec.md §3
 *
 * "지금 이 서비스가 이렇게 동작하기로 약속된 내용"을 클라이언트에게 보여준다.
 * 진행 중 요청으로 추가될 항목은 "예정 · REQ-XXX"로 미리 자리를 잡아,
 * 클라이언트가 자기 요청이 명세 어디에 반영되는지 미리 본다.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, eq, inArray } from 'drizzle-orm'
import { changeRequests } from '@ticketree/shared'
import { db } from '@/lib/data'
import { clientSections, readSpecs, sectionText } from '@/lib/specs'
import { requireProjectAccess } from '@/lib/scope'
import { clientPath } from '@/lib/routes'
import { TopBar } from '@/components/TopBar'
import { SpecNav } from '@/components/SpecNav'
import { InlineText, SpecBody } from '@/components/SpecBody'

export const dynamic = 'force-dynamic'

export default async function SpecPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ f?: string }>
}) {
  const { slug } = await params
  const { session, project, canAct } = await requireProjectAccess(slug)
  if (!project.workspacePath) redirect(clientPath.requests(slug))

  const specs = await readSpecs(project.workspacePath)
  const { f } = await searchParams
  const current = specs.find((s) => s.slug === f) ?? specs[0] ?? null

  // 예정 항목이 가리키는 요청을 스레드로 역추적할 수 있게 번호를 맞춰둔다
  const reqTags = [...new Set(specs.flatMap((s) => s.pendingReqTags))]
  const reqNos = reqTags.map((t) => Number(t.replace('REQ-', '')))
  const openRequests = reqNos.length
    ? await db
        .select({ reqNo: changeRequests.reqNo, title: changeRequests.title })
        .from(changeRequests)
        .where(
          and(eq(changeRequests.projectId, project.id), inArray(changeRequests.reqNo, reqNos)),
        )
    : []
  const titleOf = new Map(openRequests.map((r) => [`REQ-${String(r.reqNo).padStart(3, '0')}`, r.title]))

  return (
    <>
      <TopBar
        projectName={project.name}
        userName={session.name}
        slug={slug}
        canAct={canAct}
        active="spec"
      />
      <main className="wrap">
        <div className="page-head">
          <div>
            <h1>서비스 명세</h1>
            <p className="sub">
              지금 {project.name}이 동작하기로 약속된 내용이에요 — 모든 요청과 견적은 이 문서를
              기준으로 합니다
            </p>
          </div>
        </div>

        {specs.length === 0 ? (
          <div className="card">
            <p className="note" style={{ color: 'var(--faint)' }}>
              아직 정리된 명세가 없어요.
            </p>
          </div>
        ) : (
          <div className="spec-grid">
            <SpecNav
              slug={slug}
              current={current?.slug ?? null}
              items={specs.map((s) => ({
                slug: s.slug,
                title: s.title,
                layer: s.layer,
                pending: s.pendingReqTags.length,
                haystack: [
                  s.title,
                  ...s.criteria.map((c) => c.text),
                  // 내부 섹션은 검색으로도 닿으면 안 된다
                  ...clientSections(s).map((sec) => `${sec.title} ${sectionText(sec)}`),
                ].join(' '),
              }))}
            />

            <div className="spec-main">
              {current && (
                <>
                  <div className="spec-head">
                    <div>
                      <h2>{current.title}</h2>
                      <p className="vline">
                        <span className="ver">{current.version ?? '—'}</span>
                        {current.lastChanged && ` · 마지막 변경 ${current.lastChanged}`}
                      </p>
                    </div>
                    {current.pendingReqTags.length > 0 && (
                      <span className="pill amber">
                        변경 예정 {current.pendingReqTags.length}건
                      </span>
                    )}
                  </div>

                  {current.pendingReqTags.length > 0 && (
                    <div className="callout" style={{ marginBottom: 14 }}>
                      <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                        <path d="M12 9v4M12 17h.01" />
                        <circle cx="12" cy="12" r="9" />
                      </svg>
                      <div>
                        <span className="ct">변경 예정</span> —{' '}
                        {current.pendingReqTags.map((t, i) => (
                          <span key={t}>
                            {i > 0 && ', '}
                            <Link href={clientPath.request(slug, Number(t.replace('REQ-', '')))}>
                              {t} {titleOf.get(t) ?? ''}
                            </Link>
                          </span>
                        ))}
                        가 진행 중이에요. 아래에 <span className="ftag">예정</span> 표시된 항목은
                        배포가 끝나면 이 명세에 정식으로 반영됩니다.
                      </div>
                    </div>
                  )}

                  {current.criteria.length > 0 && (
                  <div className="card crit-card">
                    <p className="ch">이렇게 동작해요</p>
                    <p className="cs">각 항목은 개발 완료 시 실제로 검증되는 기준이에요</p>
                    {current.criteria.map((c, i) => (
                      <div className={`crit ${c.mark}`} key={i}>
                        {c.mark === 'done' ? (
                          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.2">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        ) : c.mark === 'pending' ? (
                          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.2">
                            <circle cx="12" cy="12" r="9" />
                            <path d="M12 7v5l3 3" />
                          </svg>
                        ) : (
                          // 상태를 단정할 수 없는 줄 — 완료로도 예정으로도 보이면 안 된다
                          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.2">
                            <circle cx="12" cy="12" r="3.5" />
                          </svg>
                        )}
                        <span>
                          <InlineText text={c.text} />
                          {c.mark === 'pending' && c.reqTag && (
                            <span className="tag">예정 · {c.reqTag}</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                  )}

                  {/* 알려진 제약 등 — 파일에 있는데 화면에 없으면 계약서가 아니다 */}
                  {clientSections(current).map((sec) => (
                    <div className="card note-card" key={sec.title}>
                      <p className="ch">{sec.title}</p>
                      <SpecBody blocks={sec.blocks} />
                    </div>
                  ))}

                  {current.history.length > 0 && (
                    <div className="card hist">
                      <p className="ch" style={{ marginBottom: 6 }}>
                        변경 이력
                      </p>
                      {current.history.map((h, i) => (
                        <div className="hist-item" key={i}>
                          <span className="hv">{h.version}</span>
                          <span>
                            <InlineText text={h.text} />
                            {/* 날짜가 없는 옛 문서는, 최신 줄에 한해 문서의 마지막 변경일을 쓴다 */}
                            {(h.date ?? (i === 0 ? current.lastChanged : null)) && (
                              <span className="hd">
                                {h.date ?? current.lastChanged}
                              </span>
                            )}
                          </span>
                          {h.reqTag && (
                            <Link
                              className="hreq"
                              href={clientPath.request(slug, Number(h.reqTag.replace('REQ-', '')))}
                            >
                              {h.reqTag}
                            </Link>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </>
  )
}
