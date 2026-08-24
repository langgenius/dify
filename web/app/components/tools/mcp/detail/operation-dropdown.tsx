'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type Props = Readonly<{
  inCard?: boolean
  onOpenChange?: (open: boolean) => void
  onEdit: () => void
  onRemove: () => void
}>

const OperationDropdown: FC<Props> = ({ inCard, onOpenChange, onEdit, onRemove }) => {
  const { t } = useTranslation()

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <IconButton
            size={inCard ? 'lg' : 'md'}
            aria-label={t(($) => $['operation.more'], { ns: 'common' })}
            className="data-popup-open:bg-state-base-hover"
          >
            <span aria-hidden className={cn('i-ri-more-fill size-4', inCard && 'size-5')} />
          </IconButton>
        }
      />
      <DropdownMenuContent placement="bottom-end" sideOffset={4} className="w-[160px]">
        <DropdownMenuItem onClick={onEdit}>
          <span aria-hidden className="i-ri-edit-line size-4 shrink-0 text-text-tertiary" />
          <div className="ml-2 system-md-regular text-text-secondary">
            {t(($) => $['mcp.operation.edit'], { ns: 'tools' })}
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="data-highlighted:bg-state-destructive-hover data-highlighted:text-text-destructive"
          onClick={onRemove}
        >
          <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0 text-inherit" />
          <div className="ml-2 system-md-regular text-inherit">
            {t(($) => $['mcp.operation.remove'], { ns: 'tools' })}
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
export default React.memo(OperationDropdown)
