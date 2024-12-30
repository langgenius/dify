import AgentLogItem from './agent-log-item'
import AgentLogNav from './agent-log-nav'
import type { AgentLogItemWithChildren } from '@/types/workflow'

type AgentResultPanelProps = {
  agentOrToolLogItemStack: { id: string; label: string }[]
  agentOrToolLogListMap: Record<string, AgentLogItemWithChildren[]>
  onShowAgentOrToolLog: (detail?: AgentLogItemWithChildren) => void
}
const AgentResultPanel = ({
  agentOrToolLogItemStack,
  agentOrToolLogListMap,
  onShowAgentOrToolLog,
}: AgentResultPanelProps) => {
  const top = agentOrToolLogItemStack[agentOrToolLogItemStack.length - 1]
  const list = agentOrToolLogListMap[top.id]

  return (
    <div className='overflow-y-auto'>
      <AgentLogNav
        agentOrToolLogItemStack={agentOrToolLogItemStack}
        agentOrToolLogListMap={agentOrToolLogListMap}
        onShowAgentOrToolLog={onShowAgentOrToolLog}
      />
      {
        <div className='p-2'>
          {
            list.map(item => (
              <AgentLogItem
                key={item.id}
                item={item}
                onShowAgentOrToolLog={onShowAgentOrToolLog}
              />
            ))
          }
        </div>
      }
    </div>
  )
}

export default AgentResultPanel
