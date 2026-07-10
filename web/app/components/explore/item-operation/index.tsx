'use client'
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
  isPinned: boolean
  isShowRenameConversation?: boolean
  onRenameConversation?: () => void
  isShowDelete: boolean
  togglePin: () => void
  onDelete: () => void
}

function ItemOperation({
  className,
  isPinned,
  togglePin,
  isShowRenameConversation,
  onRenameConversation,
  isShowDelete,
  onDelete,
}: IItemOperationProps) {
  const { t } = useTranslation('explore')
  const { t: tCommon } = useTranslation('common')

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        data-testid="item-operation-trigger"
        className={cn(
          'group/operation flex size-6 items-center justify-center rounded-md border-none p-0 text-text-tertiary transition-colors group-focus-within:bg-components-actionbar-bg! group-hover:bg-components-actionbar-bg! hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-popup-open:bg-components-actionbar-bg! data-popup-open:shadow-none!',
          className,
        )}
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        <span className="sr-only">{tCommon($ => $['operation.more'])}</span>
        <span aria-hidden className="i-ri-more-fill size-4 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 group-focus-visible/operation:opacity-100 group-data-popup-open/operation:opacity-100" />
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
          <span className={s.actionName}>{isPinned ? t($ => $['sidebar.action.unpin']) : t($ => $['sidebar.action.pin'])}</span>
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
            <span className={s.actionName}>{t($ => $['sidebar.action.rename'])}</span>
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
            <span className={cn(s.actionName, s.deleteActionItemChild, 'text-inherit')}>{t($ => $['sidebar.action.delete'])}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
export default React.memo(ItemOperation)
