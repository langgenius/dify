import { useState } from 'react'
import { RiMoreLine } from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'
import type { AgentLogItemWithChildren } from '@/types/workflow'

type AgentLogNavMoreProps = {
  options: { id: string; label: string }[]
  onShowAgentOrToolLog: (detail?: AgentLogItemWithChildren) => void
}
const AgentLogNavMore = ({
  options,
  onShowAgentOrToolLog,
}: AgentLogNavMoreProps) => {
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      placement='bottom-start'
      offset={{
        mainAxis: 2,
        crossAxis: -54,
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger>
        <Button
          className='w-6 h-6'
          variant='ghost-accent'
        >
          <RiMoreLine className='w-4 h-4' />
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className='p-1 w-[136px] bg-components-panel-bg-blur border-[0.5px] border-components-panel-border rounded-xl shadow-lg'>
          {
            options.map(option => (
              <div
                key={option.id}
                className='flex items-center px-2 h-8 rounded-lg system-md-regular text-text-secondary hover:bg-state-base-hover cursor-pointer'
                onClick={() => {
                  onShowAgentOrToolLog(option as AgentLogItemWithChildren)
                  setOpen(false)
                }}
              >
                {option.label}
              </div>
            ))
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default AgentLogNavMore
