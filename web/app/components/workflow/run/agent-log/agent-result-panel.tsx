import { RiAlertFill } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const top = agentOrToolLogItemStack[agentOrToolLogItemStack.length - 1]
  const list = agentOrToolLogListMap[top.id]

  return (
    <div className='bg-background-section overflow-y-auto'>
      <AgentLogNav
        agentOrToolLogItemStack={agentOrToolLogItemStack}
        onShowAgentOrToolLog={onShowAgentOrToolLog}
      />
      {
        <div className='space-y-1 p-2'>
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
          <div className='border-components-panel-border bg-components-panel-bg-blur mt-1 flex items-center rounded-xl border px-3 pr-2 shadow-md'>
            <div
              className='absolute inset-0 rounded-xl opacity-[0.4]'
              style={{
                background: 'linear-gradient(92deg, rgba(247, 144, 9, 0.25) 0%, rgba(255, 255, 255, 0.00) 100%)',
              }}
            ></div>
            <RiAlertFill className='text-text-warning-secondary mr-1.5 h-4 w-4' />
            <div className='system-xs-medium text-text-primary'>
              {t('runLog.circularInvocationTip')}
            </div>
          </div>
        )
      }
    </div>
  )
}

export default AgentResultPanel
