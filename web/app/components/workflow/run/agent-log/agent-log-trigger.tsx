import { RiArrowRightLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import type {
  AgentLogItemWithChildren,
  NodeTracing,
} from '@/types/workflow'

type AgentLogTriggerProps = {
  nodeInfo: NodeTracing
  onShowAgentOrToolLog: (detail?: AgentLogItemWithChildren) => void
}
const AgentLogTrigger = ({
  nodeInfo,
  onShowAgentOrToolLog,
}: AgentLogTriggerProps) => {
  const { t } = useTranslation()
  const { agentLog, execution_metadata } = nodeInfo
  const agentStrategy = execution_metadata?.tool_info?.agent_strategy

  return (
    <div
      className='bg-components-button-tertiary-bg rounded-[10px] cursor-pointer'
      onClick={() => {
        onShowAgentOrToolLog({ id: nodeInfo.id, children: agentLog || [] } as AgentLogItemWithChildren)
      }}
    >
      <div className='flex items-center px-3 pt-2 system-2xs-medium-uppercase text-text-tertiary'>
        {t('workflow.nodes.agent.strategy.label')}
      </div>
      <div className='flex items-center pl-3 pt-1 pr-2 pb-1.5'>
        {
          agentStrategy && (
            <div className='grow system-xs-medium text-text-secondary'>
              {agentStrategy}
            </div>
          )
        }
        <div
          className='shrink-0 flex items-center px-[1px] system-xs-regular-uppercase text-text-tertiary cursor-pointer'
        >
          {t('runLog.detail')}
          <RiArrowRightLine className='ml-0.5 w-3.5 h-3.5' />
        </div>
      </div>
    </div>
  )
}

export default AgentLogTrigger
