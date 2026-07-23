/**
 * 세그먼트 트랙 — spec.md §3
 *
 * 공이 클라이언트에게 있으면 앰버, 우리에게 있으면 흐린 초록.
 * 단계 자체는 몇 개뿐이고 그 안의 세부 상황은 메타 문장이 전달한다.
 *
 * 요청은 4단계, 과업내용서는 3단계다. 단어가 하나도 안 겹쳐서 한 트랙으로
 * 묶을 수 없다 — 그리는 방식만 공유한다.
 */
import { STAGES, STAGE_LABEL, stageIndex, type Stage } from '@ticketree/shared/status'
import { SOW_STAGES, SOW_STAGE_LABEL, type SowStage } from '@ticketree/shared/status'

function Segments({ count, cur, yourTurn }: { count: number; cur: number; yourTurn: boolean }) {
  return (
    <div className="track">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={
            i < cur ? 'seg done' : i === cur ? `seg cur${yourTurn ? '' : ' ours'}` : 'seg'
          }
        />
      ))}
    </div>
  )
}

export function StageTrack({ stage, yourTurn }: { stage: Stage; yourTurn: boolean }) {
  return <Segments count={STAGES.length} cur={stageIndex(stage)} yourTurn={yourTurn} />
}

export function SowTrack({ stage, yourTurn }: { stage: SowStage; yourTurn: boolean }) {
  return <Segments count={SOW_STAGES.length} cur={SOW_STAGES.indexOf(stage)} yourTurn={yourTurn} />
}

export function BigTrack({ stage }: { stage: Stage }) {
  const cur = stageIndex(stage)
  return (
    <div className="big-track">
      {STAGES.map((s, i) => (
        <div className="bseg" key={s}>
          <div className={i < cur ? 'bar done' : i === cur ? 'bar cur' : 'bar'} />
          <div className={i < cur ? 'bl done' : i === cur ? 'bl cur' : 'bl'}>{STAGE_LABEL[s]}</div>
        </div>
      ))}
    </div>
  )
}

export function BigSowTrack({ stage }: { stage: SowStage }) {
  const cur = SOW_STAGES.indexOf(stage)
  return (
    <div className="big-track">
      {SOW_STAGES.map((s, i) => (
        <div className="bseg" key={s}>
          <div className={i < cur ? 'bar done' : i === cur ? 'bar cur' : 'bar'} />
          <div className={i < cur ? 'bl done' : i === cur ? 'bl cur' : 'bl'}>
            {SOW_STAGE_LABEL[s]}
          </div>
        </div>
      ))}
    </div>
  )
}
