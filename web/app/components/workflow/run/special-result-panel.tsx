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

  agentOrToolLogItemStack?: AgentLogItemWithChildren[]
  agentOrToolLogListMap?: Record<string, AgentLogItemWithChildren[]>
  handleShowAgentOrToolLog?: (detail?: AgentLogItemWithChildren) => void
}
const SpecialResultPanel = ({
  showRetryDetail,
  setShowRetryDetailFalse,
  retryResultList,

  showIteratingDetail,
  setShowIteratingDetailFalse,
  iterationResultList,
  iterationResultDurationMap,

  agentOrToolLogItemStack,
  agentOrToolLogListMap,
  handleShowAgentOrToolLog,
}: SpecialResultPanelProps) => {
  return (
    <div onClick={(e) => {
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
    }}>
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
        !!agentOrToolLogItemStack?.length && agentOrToolLogListMap && handleShowAgentOrToolLog && (
          <AgentResultPanel
            agentOrToolLogItemStack={agentOrToolLogItemStack}
            agentOrToolLogListMap={agentOrToolLogListMap}
            onShowAgentOrToolLog={handleShowAgentOrToolLog}
          />
        )
      }
    </div>
  )
}

export default SpecialResultPanel
