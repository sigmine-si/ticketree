/**
 * 4단계 세그먼트 트랙 — spec.md §3
 *
 * 공이 클라이언트에게 있으면 앰버, 우리에게 있으면 흐린 초록.
 * 단계 자체는 4개뿐이고 그 안의 세부 상황은 메타 문장이 전달한다.
 */
import { STAGES, STAGE_LABEL, stageIndex, type Stage } from '@ticketree/shared/status'

export function StageTrack({ stage, yourTurn }: { stage: Stage; yourTurn: boolean }) {
  const cur = stageIndex(stage)
  return (
    <div className="track">
      {STAGES.map((s, i) => (
        <span
          key={s}
          className={
            i < cur ? 'seg done' : i === cur ? `seg cur${yourTurn ? '' : ' ours'}` : 'seg'
          }
        />
      ))}
    </div>
  )
}

export function BigTrack({ stage }: { stage: Stage }) {
  const cur = stageIndex(stage)
  return (
    <div className="big-track">
      {STAGES.map((s, i) => (
        <div className="bseg" key={s}>
          <div className={i < cur ? 'bar done' : i === cur ? 'bar cur' : 'bar'} />
          <div className={i < cur ? 'bl done' : i === cur ? 'bl cur' : 'bl'}>
            {STAGE_LABEL[s]}
          </div>
        </div>
      ))}
    </div>
  )
}
