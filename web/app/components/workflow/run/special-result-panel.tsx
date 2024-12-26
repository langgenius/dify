import { RetryResultPanel } from './retry-log'
import { IterationResultPanel } from './iteration-log'
import { AgentResultPanel } from './agent-log'
import type { IterationDurationMap, NodeTracing } from '@/types/workflow'

type SpecialResultPanelProps = {
  showRetryDetail: boolean
  setShowRetryDetailFalse: () => void
  retryResultList: NodeTracing[]

  showIteratingDetail: boolean
  setShowIteratingDetailFalse: () => void
  iterationResultList: NodeTracing[][]
  iterationResultDurationMap: IterationDurationMap

  showAgentDetail: boolean
  setShowAgentDetailFalse: () => void
}
const SpecialResultPanel = ({
  showRetryDetail,
  setShowRetryDetailFalse,
  retryResultList,

  showIteratingDetail,
  setShowIteratingDetailFalse,
  iterationResultList,
  iterationResultDurationMap,

  showAgentDetail,
  setShowAgentDetailFalse,
}: SpecialResultPanelProps) => {
  return (
    <>
      {
        showRetryDetail && (
          <RetryResultPanel
            list={retryResultList}
            onBack={setShowRetryDetailFalse}
          />
        )
      }
      {
        showIteratingDetail && (
          <IterationResultPanel
            list={iterationResultList}
            onHide={setShowIteratingDetailFalse}
            onBack={setShowIteratingDetailFalse}
            iterDurationMap={iterationResultDurationMap}
          />
        )
      }
      {
        showAgentDetail && (
          <AgentResultPanel
            onBack={setShowAgentDetailFalse}
          />
        )
      }
    </>
  )
}

export default SpecialResultPanel
