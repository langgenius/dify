'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
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

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        data-testid="item-operation-trigger"
        className={cn(
          s.btn,
          'size-6 rounded-md border-none py-1 data-popup-open:bg-components-actionbar-bg! data-popup-open:shadow-none!',
          isItemHovering && `${s.open} bg-components-actionbar-bg! shadow-none!`,
          className,
        )}
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
      >
        <DropdownMenuItem
          className={cn(s.actionItem, 'gap-2 px-3')}
          onClick={(e) => {
            e.stopPropagation()
            togglePin()
          }}
        >
          <Pin02 className="size-4 shrink-0 text-text-secondary" />
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
            <span aria-hidden className="i-ri-edit-line size-4 shrink-0 text-text-secondary" />
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
            <span aria-hidden className={cn(s.deleteActionItemChild, 'i-ri-delete-bin-line size-4 shrink-0 text-inherit')} />
            <span className={cn(s.actionName, s.deleteActionItemChild, 'text-inherit')}>{t('sidebar.action.delete')}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
export default React.memo(ItemOperation)
