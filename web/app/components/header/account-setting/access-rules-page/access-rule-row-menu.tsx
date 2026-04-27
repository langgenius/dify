'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useState } from 'react'
import ActionButton from '@/app/components/base/action-button'

export type AccessRuleRowMenuProps = {
  onEdit?: () => void
  onCopy?: () => void
  onDelete?: () => void
}

const AccessRuleRowMenu = ({
  onEdit,
  onCopy,
  onDelete,
}: AccessRuleRowMenuProps) => {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={(
          <ActionButton
            size="l"
            className={open ? 'bg-state-base-hover' : ''}
            aria-label="More actions"
          />
        )}
      >
        <span aria-hidden className="i-ri-more-fill h-4 w-4 text-text-tertiary" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName="min-w-[140px]"
      >
        <DropdownMenuItem
          className="system-sm-semibold text-text-secondary"
          onClick={onEdit}
        >
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem
          className="system-sm-semibold text-text-secondary"
          onClick={onCopy}
        >
          Copy
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          className="system-sm-semibold"
          onClick={onDelete}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default AccessRuleRowMenu
