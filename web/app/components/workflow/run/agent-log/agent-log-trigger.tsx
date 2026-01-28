import type {
  AgentLogItemWithChildren,
  NodeTracing,
} from '@/types/workflow'
import { RiArrowRightLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'

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
      className="cursor-pointer rounded-[10px] bg-components-button-tertiary-bg"
      onClick={() => {
        onShowAgentOrToolLog({ message_id: nodeInfo.id, children: agentLog || [] } as AgentLogItemWithChildren)
      }}
    >
      <div className="system-2xs-medium-uppercase flex items-center px-3 pt-2 text-text-tertiary">
        {t('nodes.agent.strategy.label', { ns: 'workflow' })}
      </div>
      <div className="flex items-center pb-1.5 pl-3 pr-2 pt-1">
        {
          agentStrategy && (
            <div className="system-xs-medium grow text-text-secondary">
              {agentStrategy}
            </div>
          )
        }
        <div
          className="system-xs-regular-uppercase flex shrink-0 cursor-pointer items-center px-[1px] text-text-tertiary"
        >
          {t('detail', { ns: 'runLog' })}
          <RiArrowRightLine className="ml-0.5 h-3.5 w-3.5" />
        </div>
      </div>
    </div>
  )
}

export default AgentLogTrigger
