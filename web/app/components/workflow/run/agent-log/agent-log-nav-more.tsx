import type { AgentLogItemWithChildren } from '@/types/workflow'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type AgentLogNavMoreProps = {
  options: AgentLogItemWithChildren[]
  onShowAgentOrToolLog: (detail?: AgentLogItemWithChildren) => void
}
const AgentLogNavMore = ({ options, onShowAgentOrToolLog }: AgentLogNavMoreProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <IconButton
            aria-label={t(($) => $['operation.more'], { ns: 'common' })}
            size="md"
            variant="ghost-accent"
            className="rounded-lg"
          >
            <span aria-hidden className="i-ri-more-line size-4" />
          </IconButton>
        }
      />
      <DropdownMenuContent
        placement="bottom-start"
        sideOffset={2}
        alignOffset={-54}
        className="w-[136px] p-1"
      >
        {options.map((option) => (
          <DropdownMenuItem
            key={option.message_id}
            className="system-md-regular"
            onClick={() => onShowAgentOrToolLog(option)}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default AgentLogNavMore
