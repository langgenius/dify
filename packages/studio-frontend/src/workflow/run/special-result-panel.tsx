import type {
  AgentLogItemWithChildren,
  IterationDurationMap,
  LoopDurationMap,
  LoopVariableMap,
  NodeTracing,
} from '@/types/workflow'
import { AgentResultPanel } from '../run/agent-log/index'
import { IterationResultPanel } from '../run/iteration-log/index'
import { LoopResultPanel } from '../run/loop-log/index'
import { RetryResultPanel } from '../run/retry-log/index'

export type SpecialResultPanelProps = {
  showRetryDetail?: boolean
  setShowRetryDetailFalse?: () => void
  retryResultList?: NodeTracing[]

  showIteratingDetail?: boolean
  setShowIteratingDetailFalse?: () => void
  iterationResultList?: NodeTracing[][]
  iterationResultDurationMap?: IterationDurationMap

  showLoopingDetail?: boolean
  setShowLoopingDetailFalse?: () => void
  loopResultList?: NodeTracing[][]
  loopResultDurationMap?: LoopDurationMap
  loopResultVariableMap?: LoopVariableMap

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

  showLoopingDetail,
  setShowLoopingDetailFalse,
  loopResultList,
  loopResultDurationMap,
  loopResultVariableMap,

  agentOrToolLogItemStack,
  agentOrToolLogListMap,
  handleShowAgentOrToolLog,
}: SpecialResultPanelProps) => {
  return (
    <div onClick={(e) => {
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
    }}
    >
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
        showLoopingDetail && !!loopResultList?.length && setShowLoopingDetailFalse && (
          <LoopResultPanel
            list={loopResultList}
            onBack={setShowLoopingDetailFalse}
            loopDurationMap={loopResultDurationMap}
            loopVariableMap={loopResultVariableMap}
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
