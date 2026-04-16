'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  RiDeleteBinLine,
  RiEditLine,
  RiMoreFill,
} from '@remixicon/react'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'

type Props = {
  inCard?: boolean
  onOpenChange?: (open: boolean) => void
  onEdit: () => void
  onRemove: () => void
}

const OperationDropdown: FC<Props> = ({
  inCard,
  onOpenChange,
  onEdit,
  onRemove,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }, [onOpenChange])

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        render={<ActionButton size={inCard ? 'l' : 'm'} className={cn(open && 'bg-state-base-hover')} />}
      >
        <RiMoreFill className={cn('h-4 w-4', inCard && 'h-5 w-5')} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName="w-[160px]"
      >
        <DropdownMenuItem onClick={onEdit}>
          <RiEditLine className="h-4 w-4 shrink-0 text-text-tertiary" />
          <div className="ml-2 system-md-regular text-text-secondary">{t('mcp.operation.edit', { ns: 'tools' })}</div>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="data-highlighted:bg-state-destructive-hover data-highlighted:text-text-destructive"
          onClick={onRemove}
        >
          <RiDeleteBinLine className="h-4 w-4 shrink-0 text-inherit" />
          <div className="ml-2 system-md-regular text-inherit">{t('mcp.operation.remove', { ns: 'tools' })}</div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
export default React.memo(OperationDropdown)
