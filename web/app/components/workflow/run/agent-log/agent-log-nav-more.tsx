import type { AgentLogItemWithChildren } from '@/types/workflow'
import { RiMoreLine } from '@remixicon/react'
import { useState } from 'react'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

type AgentLogNavMoreProps = {
  options: AgentLogItemWithChildren[]
  onShowAgentOrToolLog: (detail?: AgentLogItemWithChildren) => void
}
const AgentLogNavMore = ({
  options,
  onShowAgentOrToolLog,
}: AgentLogNavMoreProps) => {
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      placement="bottom-start"
      offset={{
        mainAxis: 2,
        crossAxis: -54,
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger>
        <Button
          className="h-6 w-6"
          variant="ghost-accent"
        >
          <RiMoreLine className="h-4 w-4" />
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className="w-[136px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg">
          {
            options.map(option => (
              <div
                key={option.message_id}
                className="system-md-regular flex h-8 cursor-pointer items-center rounded-lg px-2 text-text-secondary hover:bg-state-base-hover"
                onClick={() => {
                  onShowAgentOrToolLog(option)
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
