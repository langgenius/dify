import AgentLogItem from './agent-log-item'
import AgentLogNav from './agent-log-nav'
import type { AgentLogItemWithChildren } from '@/types/workflow'

type AgentResultPanelProps = {
  agentOrToolLogIdStack: string[]
  agentOrToolLogListMap: Record<string, AgentLogItemWithChildren[]>
  onShowAgentOrToolLog: (detail: AgentLogItemWithChildren) => void
}
const AgentResultPanel = ({
  agentOrToolLogIdStack,
  agentOrToolLogListMap,
  onShowAgentOrToolLog,
}: AgentResultPanelProps) => {
  const top = agentOrToolLogIdStack[agentOrToolLogIdStack.length - 1]
  const list = agentOrToolLogListMap[top]

  return (
    <div className='overflow-y-auto'>
      <AgentLogNav />
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
