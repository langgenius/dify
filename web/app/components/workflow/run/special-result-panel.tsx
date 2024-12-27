import { RetryResultPanel } from './retry-log'
import { IterationResultPanel } from './iteration-log'
import { AgentResultPanel } from './agent-log'
import type {
  AgentLogItemWithChildren,
  IterationDurationMap,
  NodeTracing,
} from '@/types/workflow'

export type SpecialResultPanelProps = {
  showRetryDetail?: boolean
  setShowRetryDetailFalse?: () => void
  retryResultList?: NodeTracing[]

  showIteratingDetail?: boolean
  setShowIteratingDetailFalse?: () => void
  iterationResultList?: NodeTracing[][]
  iterationResultDurationMap?: IterationDurationMap

  agentResultList?: AgentLogItemWithChildren[]
  setAgentResultList?: (list: AgentLogItemWithChildren[]) => void
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
        !!showRetryDetail && !!retryResultList?.length && setShowRetryDetailFalse && (
          <RetryResultPanel
            list={retryResultList}
            onBack={setShowRetryDetailFalse}
          />
        )
      }
      {
        showIteratingDetail && !!iterationResultList?.length && setShowIteratingDetailFalse && (
          <IterationResultPanel
            list={iterationResultList}
            onBack={setShowIteratingDetailFalse}
            iterDurationMap={iterationResultDurationMap}
          />
        )
      }
      {
        !!agentResultList?.length && setAgentResultList && (
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
