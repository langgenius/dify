import { RiArrowLeftLine } from '@remixicon/react'
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
  const options = agentOrToolLogItemStack.slice(2)

  return (
    <div className='flex items-center p-1 pr-3 h-8'>
      <Button
        className='shrink-0 px-[5px]'
        size='small'
        variant='ghost-accent'
        onClick={() => onShowAgentOrToolLog()}
      >
        <RiArrowLeftLine className='mr-1 w-3.5 h-3.5' />
        Agent
      </Button>
      <div className='shrink-0 mx-0.5 system-xs-regular text-divider-deep'>/</div>
      <Button
        className='shrink-0 px-[5px]'
        size='small'
        variant='ghost-accent'
        onClick={() => {}}
      >
        <RiArrowLeftLine className='mr-1 w-3.5 h-3.5' />
        Agent strategy
      </Button>
      {
        !!options.length && (
          <>
            <div className='shrink-0 mx-0.5 system-xs-regular text-divider-deep'>/</div>
            <AgentLogNavMore
              options={options}
              onShowAgentOrToolLog={onShowAgentOrToolLog}
            />
          </>
        )
      }
      <div className='shrink-0 mx-0.5 system-xs-regular text-divider-deep'>/</div>
      <div className='flex items-center px-[5px] system-xs-medium-uppercase text-text-tertiary'>
        Run Actions
      </div>
    </div>
  )
}

export default AgentLogNav
