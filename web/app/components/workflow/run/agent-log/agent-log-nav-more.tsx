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
          className='h-6 w-6'
          variant='ghost-accent'
        >
          <RiMoreLine className='h-4 w-4' />
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className='bg-components-panel-bg-blur border-components-panel-border w-[136px] rounded-xl border-[0.5px] p-1 shadow-lg'>
          {
            options.map(option => (
              <div
                key={option.id}
                className='system-md-regular text-text-secondary hover:bg-state-base-hover flex h-8 cursor-pointer items-center rounded-lg px-2'
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
