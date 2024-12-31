import { RiAlertFill } from '@remixicon/react'
import AgentLogItem from './agent-log-item'
import AgentLogNav from './agent-log-nav'
import type { AgentLogItemWithChildren } from '@/types/workflow'

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
  const top = agentOrToolLogItemStack[agentOrToolLogItemStack.length - 1]
  const list = agentOrToolLogListMap[top.id]

  return (
    <div className='overflow-y-auto'>
      <AgentLogNav
        agentOrToolLogItemStack={agentOrToolLogItemStack}
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
      {
        top.hasCircle && (
          <div className='flex items-center rounded-xl px-3 pr-2 border border-components-panel-border bg-components-panel-bg-blur shadow-md'>
            <div
              className='absolute inset-0 opacity-[0.4] rounded-xl'
              style={{
                background: 'linear-gradient(92deg, rgba(247, 144, 9, 0.25) 0%, rgba(255, 255, 255, 0.00) 100%)',
              }}
            ></div>
            <RiAlertFill className='mr-1.5 w-4 h-4 text-text-warning-secondary' />
            <div className='system-xs-medium text-text-primary'>
              There is circular invocation of tools/nodes in the current workflow.
            </div>
          </div>
        )
      }
    </div>
  )
}

export default AgentResultPanel