import AgentLogItem from './agent-log-item'
import AgentLogNav from './agent-log-nav'
import type { AgentLogItemWithChildren } from '@/types/workflow'

type AgentResultPanelProps = {
  list: AgentLogItemWithChildren[]
  setAgentResultList: (list: AgentLogItemWithChildren[]) => void
}
const AgentResultPanel = ({
  list,
}: AgentResultPanelProps) => {
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
              />
            ))
          }
        </div>
      }
    </div>
  )
}

export default AgentResultPanel
