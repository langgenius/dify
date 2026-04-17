import type { AgentLogItemWithChildren } from '@/types/workflow'
import { RiMoreLine } from '@remixicon/react'
import { useState } from 'react'
import { Button } from '@/app/components/base/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'

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
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuTrigger
        render={(
          <Button
            className="h-6 w-6"
            variant="ghost-accent"
          />
        )}
      >
        <RiMoreLine className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-start"
        sideOffset={2}
        alignOffset={-54}
        popupClassName="w-[136px] p-1"
      >
        {
          options.map(option => (
            <DropdownMenuItem
              key={option.message_id}
              className="system-md-regular"
              onClick={() => onShowAgentOrToolLog(option)}
            >
              {option.label}
            </DropdownMenuItem>
          ))
        }
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default AgentLogNavMore
