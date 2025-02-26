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
    <div className='flex items-center p-1 pr-3 h-8 bg-components-panel-bg'>
      <Button
        className='shrink-0 px-[5px]'
        size='small'
        variant='ghost-accent'
        onClick={() => {
          onShowAgentOrToolLog()
        }}
      >
        <RiArrowLeftLine className='mr-1 w-3.5 h-3.5' />
        AGENT
      </Button>
      <div className='shrink-0 mx-0.5 system-xs-regular text-divider-deep'>/</div>
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
            <div className='flex items-center px-[5px] system-xs-medium-uppercase text-text-tertiary'>
              {t('workflow.nodes.agent.strategy.label')}
            </div>
          )
      }
      {
        !!mid.length && (
          <>
            <div className='shrink-0 mx-0.5 system-xs-regular text-divider-deep'>/</div>
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
            <div className='shrink-0 mx-0.5 system-xs-regular text-divider-deep'>/</div>
            <div className='flex items-center px-[5px] system-xs-medium-uppercase text-text-tertiary'>
              {end.label}
            </div>
          </>
        )
      }
    </div>
  )
}

export default AgentLogNav
