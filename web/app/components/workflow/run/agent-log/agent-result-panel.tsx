import type { AgentLogItemWithChildren } from '@/types/workflow'
import { Alert, AlertTitle } from '@langgenius/dify-ui/alert'
import { useTranslation } from 'react-i18next'
import AgentLogItem from './agent-log-item'
import { AgentLogNav } from './agent-log-nav'

type AgentResultPanelProps = {
  agentOrToolLogItemStack: AgentLogItemWithChildren[]
  agentOrToolLogListMap: Record<string, AgentLogItemWithChildren[]>
  onShowAgentOrToolLog: (detail?: AgentLogItemWithChildren) => void
}
const AgentResultPanel = ({
  agentOrToolLogItemStack,
  agentOrToolLogListMap,
  onShowAgentOrToolLog,
}: AgentResultPanelProps) => {
  const { t } = useTranslation(['runLog'])
  const top = agentOrToolLogItemStack[agentOrToolLogItemStack.length - 1]
  const list = agentOrToolLogListMap[top!.message_id]

  return (
    <div className="overflow-y-auto bg-background-section">
      <AgentLogNav
        agentOrToolLogItemStack={agentOrToolLogItemStack}
        onShowAgentOrToolLog={onShowAgentOrToolLog}
      />
      <div className="space-y-1 p-2">
        {list!.map((item) => (
          <AgentLogItem
            key={item.message_id}
            item={item}
            onShowAgentOrToolLog={onShowAgentOrToolLog}
          />
        ))}
      </div>
      {top!.hasCircle && (
        <Alert type="warning" className="mt-1">
          <AlertTitle>{t(($) => $.circularInvocationTip, { ns: 'runLog' })}</AlertTitle>
        </Alert>
      )}
    </div>
  )
}

export default AgentResultPanel
