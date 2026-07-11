'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import {
  RiDeleteBinLine,
  RiEditLine,
  RiMoreFill,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'

type Props = Readonly<{
  inCard?: boolean
  onOpenChange?: (open: boolean) => void
  onEdit: () => void
  onRemove: () => void
}>

const OperationDropdown: FC<Props> = ({
  inCard,
  onOpenChange,
  onEdit,
  onRemove,
}) => {
  const { t } = useTranslation()

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={<ActionButton size={inCard ? 'l' : 'm'} className="data-popup-open:bg-state-base-hover" />}
      >
        <RiMoreFill className={cn('size-4', inCard && 'size-5')} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName="w-[160px]"
      >
        <DropdownMenuItem onClick={onEdit}>
          <RiEditLine className="size-4 shrink-0 text-text-tertiary" />
          <div className="ml-2 system-md-regular text-text-secondary">{t($ => $['mcp.operation.edit'], { ns: 'tools' })}</div>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="data-highlighted:bg-state-destructive-hover data-highlighted:text-text-destructive"
          onClick={onRemove}
        >
          <RiDeleteBinLine className="size-4 shrink-0 text-inherit" />
          <div className="ml-2 system-md-regular text-inherit">{t($ => $['mcp.operation.remove'], { ns: 'tools' })}</div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
export default React.memo(OperationDropdown)
