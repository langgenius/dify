import { RiArrowRightLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import type {
  AgentLogItemWithChildren,
  NodeTracing,
} from '@/types/workflow'
import { BlockEnum } from '@/app/components/workflow/types'

type AgentLogTriggerProps = {
  nodeInfo: NodeTracing
  onShowAgentOrToolLog: (detail?: AgentLogItemWithChildren) => void
}
const AgentLogTrigger = ({
  nodeInfo,
  onShowAgentOrToolLog,
}: AgentLogTriggerProps) => {
  const { t } = useTranslation()
  const { agentLog, execution_metadata, node_type } = nodeInfo
  const agentStrategy = execution_metadata?.tool_info?.agent_strategy

  // For LLM node, show different label
  const isLLMNode = node_type === BlockEnum.LLM
  const label = isLLMNode ? t('workflow.nodes.llm.tools').toUpperCase() : t('workflow.nodes.agent.strategy.label')

  return (
    <div
      className='cursor-pointer rounded-[10px] bg-components-button-tertiary-bg'
      onClick={() => {
        onShowAgentOrToolLog({ message_id: nodeInfo.id, children: agentLog || [] } as AgentLogItemWithChildren)
      }}
    >
      <div className='system-2xs-medium-uppercase flex items-center px-3 pt-2 text-text-tertiary'>
        {label}
      </div>
      <div className='flex items-center pb-1.5 pl-3 pr-2 pt-1'>
        {
          !isLLMNode && agentStrategy && (
            <div className='system-xs-medium grow text-text-secondary'>
              {agentStrategy}
            </div>
          )
        }
        <div
          className='system-xs-regular-uppercase flex shrink-0 cursor-pointer items-center px-[1px] text-text-tertiary'
        >
          {t('runLog.detail')}
          <RiArrowRightLine className='ml-0.5 h-3.5 w-3.5' />
        </div>
      </div>
    </div>
  )
}

export default AgentLogTrigger
