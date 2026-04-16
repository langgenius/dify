'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  RiDeleteBinLine,
  RiEditLine,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
import { Pin02 } from '../../base/icons/src/vender/line/general'
import s from './style.module.css'

type IItemOperationProps = {
  className?: string
  isItemHovering?: boolean
  isPinned: boolean
  isShowRenameConversation?: boolean
  onRenameConversation?: () => void
  isShowDelete: boolean
  togglePin: () => void
  onDelete: () => void
}

const ItemOperation: FC<IItemOperationProps> = ({
  className,
  isItemHovering,
  isPinned,
  togglePin,
  isShowRenameConversation,
  onRenameConversation,
  isShowDelete,
  onDelete,
}) => {
  const { t } = useTranslation('explore')
  const { t: tCommon } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [isHovering, { setTrue: setIsHovering, setFalse: setNotHovering }] = useBoolean(false)
  useEffect(() => {
    if (!isItemHovering && !isHovering)
      setOpen(false)
  }, [isItemHovering, isHovering])
  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuTrigger
        data-testid="item-operation-trigger"
        className={cn(className, s.btn, 'h-6 w-6 rounded-md border-none py-1', (isItemHovering || open) && `${s.open} bg-components-actionbar-bg! shadow-none!`)}
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        <span className="sr-only">{tCommon('operation.more')}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName="min-w-[120px]"
        popupProps={{
          onMouseEnter: setIsHovering,
          onMouseLeave: setNotHovering,
          onClick: e => e.stopPropagation(),
        }}
      >
        <DropdownMenuItem
          className={cn(s.actionItem, 'gap-2 px-3')}
          onClick={(e) => {
            e.stopPropagation()
            togglePin()
          }}
        >
          <Pin02 className="h-4 w-4 shrink-0 text-text-secondary" />
          <span className={s.actionName}>{isPinned ? t('sidebar.action.unpin') : t('sidebar.action.pin')}</span>
        </DropdownMenuItem>
        {isShowRenameConversation && (
          <DropdownMenuItem
            className={cn(s.actionItem, 'gap-2 px-3')}
            onClick={(e) => {
              e.stopPropagation()
              onRenameConversation?.()
            }}
          >
            <RiEditLine className="h-4 w-4 shrink-0 text-text-secondary" />
            <span className={s.actionName}>{t('sidebar.action.rename')}</span>
          </DropdownMenuItem>
        )}
        {isShowDelete && (
          <DropdownMenuItem
            className={cn(s.actionItem, s.deleteActionItem, 'gap-2 px-3 data-highlighted:bg-state-destructive-hover data-highlighted:text-text-destructive')}
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <RiDeleteBinLine className={cn(s.deleteActionItemChild, 'h-4 w-4 shrink-0 stroke-current stroke-2 text-inherit')} />
            <span className={cn(s.actionName, s.deleteActionItemChild, 'text-inherit')}>{t('sidebar.action.delete')}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
export default React.memo(ItemOperation)
