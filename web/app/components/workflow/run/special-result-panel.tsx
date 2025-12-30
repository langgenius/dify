import type {
  AgentLogItemWithChildren,
  IterationDurationMap,
  LoopDurationMap,
  LoopVariableMap,
  NodeTracing,
} from '@/types/workflow'
import { AgentResultPanel } from './agent-log'
import { IterationResultPanel } from './iteration-log'
import { LLMResultPanel } from './llm-log'
import { LoopResultPanel } from './loop-log'
import { RetryResultPanel } from './retry-log'

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

  showLLMDetail?: boolean
  setShowLLMDetailFalse?: () => void
  llmResultList?: NodeTracing[]
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

  showLLMDetail,
  setShowLLMDetailFalse,
  llmResultList,
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
        !!showLLMDetail && !!llmResultList?.length && setShowLLMDetailFalse && (
          <LLMResultPanel
            list={llmResultList}
            onBack={setShowLLMDetailFalse}
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
