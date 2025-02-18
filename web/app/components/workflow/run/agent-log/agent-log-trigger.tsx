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
      className='bg-components-button-tertiary-bg cursor-pointer rounded-[10px]'
      onClick={() => {
        onShowAgentOrToolLog({ id: nodeInfo.id, children: agentLog || [] } as AgentLogItemWithChildren)
      }}
    >
      <div className='system-2xs-medium-uppercase text-text-tertiary flex items-center px-3 pt-2'>
        {t('workflow.nodes.agent.strategy.label')}
      </div>
      <div className='flex items-center pb-1.5 pl-3 pr-2 pt-1'>
        {
          agentStrategy && (
            <div className='system-xs-medium text-text-secondary grow'>
              {agentStrategy}
            </div>
          )
        }
        <div
          className='system-xs-regular-uppercase text-text-tertiary flex shrink-0 cursor-pointer items-center px-[1px]'
        >
          {t('runLog.detail')}
          <RiArrowRightLine className='ml-0.5 h-3.5 w-3.5' />
        </div>
      </div>
    </div>
  )
}

export default AgentLogTrigger
