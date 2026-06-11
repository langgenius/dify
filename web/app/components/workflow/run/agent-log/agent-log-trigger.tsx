import type {
  AgentLogItemWithChildren,
  NodeTracing,
} from '@/types/workflow'
import { useTranslation } from 'react-i18next'

type AgentLogTriggerProps = {
  nodeInfo: NodeTracing
  onShowAgentOrToolLog: (detail?: AgentLogItemWithChildren) => void
}
export function AgentLogTrigger({
  nodeInfo,
  onShowAgentOrToolLog,
}: AgentLogTriggerProps) {
  const { t } = useTranslation()
  const { agentLog, execution_metadata } = nodeInfo
  const agentStrategy = execution_metadata?.tool_info?.agent_strategy

  return (
    <button
      type="button"
      className="w-full cursor-pointer rounded-[10px] bg-components-button-tertiary-bg text-left focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
      onClick={() => {
        onShowAgentOrToolLog({ message_id: nodeInfo.id, children: agentLog || [] } as AgentLogItemWithChildren)
      }}
    >
      <div className="flex items-center px-3 pt-2 system-2xs-medium-uppercase text-text-tertiary">
        {t('nodes.agent.strategy.label', { ns: 'workflow' })}
      </div>
      <div className="flex items-center pt-1 pr-2 pb-1.5 pl-3">
        {agentStrategy
          ? (
              <div className="grow system-xs-medium text-text-secondary">
                {agentStrategy}
              </div>
            )
          : <div className="grow" />}
        <div
          className="flex shrink-0 cursor-pointer items-center px-px system-xs-regular-uppercase text-text-tertiary"
        >
          {t('detail', { ns: 'runLog' })}
          <span aria-hidden className="ml-0.5 i-ri-arrow-right-line size-3.5" />
        </div>
      </div>
    </button>
  )
}
