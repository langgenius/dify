import { RetryResultPanel } from './retry-log'
import { IterationResultPanel } from './iteration-log'
import { AgentResultPanel } from './agent-log'
import type {
  AgentLogItemWithChildren,
  IterationDurationMap,
  NodeTracing,
} from '@/types/workflow'

type SpecialResultPanelProps = {
  showRetryDetail: boolean
  setShowRetryDetailFalse: () => void
  retryResultList: NodeTracing[]

  showIteratingDetail: boolean
  setShowIteratingDetailFalse: () => void
  iterationResultList: NodeTracing[][]
  iterationResultDurationMap: IterationDurationMap

  agentResultList: AgentLogItemWithChildren[]
  setAgentResultList: (list: AgentLogItemWithChildren[]) => void
}
const SpecialResultPanel = ({
  showRetryDetail,
  setShowRetryDetailFalse,
  retryResultList,

  showIteratingDetail,
  setShowIteratingDetailFalse,
  iterationResultList,
  iterationResultDurationMap,

  agentResultList,
  setAgentResultList,
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
            onBack={setShowIteratingDetailFalse}
            iterDurationMap={iterationResultDurationMap}
          />
        )
      }
      {
        !!agentResultList.length && (
          <AgentResultPanel
            list={agentResultList}
            setAgentResultList={setAgentResultList}
          />
        )
      }
    </>
  )
}

export default SpecialResultPanel
