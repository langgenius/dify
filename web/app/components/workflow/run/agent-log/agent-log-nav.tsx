import { RiArrowLeftLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import AgentLogNavMore from './agent-log-nav-more'
import Button from '@/app/components/base/button'
import type { AgentLogItemWithChildren } from '@/types/workflow'

type AgentLogNavProps = {
  agentOrToolLogItemStack: AgentLogItemWithChildren[]
  onShowAgentOrToolLog: (detail?: AgentLogItemWithChildren) => void
}
const AgentLogNav = ({
  agentOrToolLogItemStack,
  onShowAgentOrToolLog,
}: AgentLogNavProps) => {
  const { t } = useTranslation()
  const agentOrToolLogItemStackLength = agentOrToolLogItemStack.length
  const first = agentOrToolLogItemStack[0]
  const mid = agentOrToolLogItemStack.slice(1, -1)
  const end = agentOrToolLogItemStack.at(-1)

  return (
    <div className='bg-components-panel-bg flex h-8 items-center p-1 pr-3'>
      <Button
        className='shrink-0 px-[5px]'
        size='small'
        variant='ghost-accent'
        onClick={() => {
          onShowAgentOrToolLog()
        }}
      >
        <RiArrowLeftLine className='mr-1 h-3.5 w-3.5' />
        AGENT
      </Button>
      <div className='system-xs-regular text-divider-deep mx-0.5 shrink-0'>/</div>
      {
        agentOrToolLogItemStackLength > 1
          ? (
            <Button
              className='shrink-0 px-[5px]'
              size='small'
              variant='ghost-accent'
              onClick={() => onShowAgentOrToolLog(first)}
            >
              {t('workflow.nodes.agent.strategy.label')}
            </Button>
          )
          : (
            <div className='system-xs-medium-uppercase text-text-tertiary flex items-center px-[5px]'>
              {t('workflow.nodes.agent.strategy.label')}
            </div>
          )
      }
      {
        !!mid.length && (
          <>
            <div className='system-xs-regular text-divider-deep mx-0.5 shrink-0'>/</div>
            <AgentLogNavMore
              options={mid}
              onShowAgentOrToolLog={onShowAgentOrToolLog}
            />
          </>
        )
      }
      {
        !!end && agentOrToolLogItemStackLength > 1 && (
          <>
            <div className='system-xs-regular text-divider-deep mx-0.5 shrink-0'>/</div>
            <div className='system-xs-medium-uppercase text-text-tertiary flex items-center px-[5px]'>
              {end.label}
            </div>
          </>
        )
      }
    </div>
  )
}

export default AgentLogNav
