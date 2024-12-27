import Button from '@/app/components/base/button'
import { RiArrowLeftLine } from '@remixicon/react'
import AgentLogItem from './agent-log-item'
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
      <div className='flex items-center p-1 pr-3 h-8'>
        <Button
          className='shrink-0 px-[5px]'
          size='small'
          variant='ghost-accent'
          onClick={() => {}}
        >
          <RiArrowLeftLine className='mr-1 w-3.5 h-3.5' />
          Back
        </Button>
        <div className='shrink-0 mx-0.5 system-xs-regular text-divider-deep'>/</div>
        <div className='grow px-[5px] system-xs-medium-uppercase'>
          Agent strategy
        </div>
        <Button
          className='px-[5px]'
          size='small'
          variant='ghost-accent'
          onClick={() => {}}
        >
          close
        </Button>
      </div>
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
