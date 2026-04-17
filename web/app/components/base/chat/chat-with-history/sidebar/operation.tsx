'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'

type Props = {
  isActive?: boolean
  isItemHovering?: boolean
  isPinned: boolean
  isShowRenameConversation?: boolean
  onRenameConversation?: () => void
  isShowDelete: boolean
  togglePin: () => void
  onDelete: () => void
}

const Operation: FC<Props> = ({
  isActive,
  isItemHovering,
  isPinned,
  togglePin,
  isShowRenameConversation,
  onRenameConversation,
  isShowDelete,
  onDelete,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [isHovering, { setTrue: setIsHovering, setFalse: setNotHovering }] = useBoolean(false)
  useEffect(() => {
    if (!isItemHovering && !isHovering)
      setOpen(false)
  }, [isItemHovering, isHovering])
  const handleDeferredAction = useCallback((action?: () => void) => {
    if (!action)
      return
    setOpen(false)
    queueMicrotask(action)
  }, [])
  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuTrigger
        render={<div />}
        onClick={e => e.stopPropagation()}
      >
        <ActionButton
          className={cn((isItemHovering || open) ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0')}
          state={
            isActive
              ? ActionButtonState.Active
              : open
                ? ActionButtonState.Hover
                : ActionButtonState.Default
          }
        >
          <span aria-hidden className="i-ri-more-fill h-4 w-4" />
        </ActionButton>
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
          className="gap-2 px-2 system-md-regular"
          onClick={(e) => {
            e.stopPropagation()
            togglePin()
          }}
        >
          {isPinned && <span aria-hidden className="i-ri-unpin-line h-4 w-4 shrink-0 text-text-tertiary" />}
          {!isPinned && <span aria-hidden className="i-ri-pushpin-line h-4 w-4 shrink-0 text-text-tertiary" />}
          <span className="grow">{isPinned ? t('sidebar.action.unpin', { ns: 'explore' }) : t('sidebar.action.pin', { ns: 'explore' })}</span>
        </DropdownMenuItem>
        {isShowRenameConversation && (
          <DropdownMenuItem
            className="gap-2 px-2 system-md-regular"
            onClick={(e) => {
              e.stopPropagation()
              handleDeferredAction(onRenameConversation)
            }}
          >
            <span aria-hidden className="i-ri-edit-line h-4 w-4 shrink-0 text-text-tertiary" />
            <span className="grow">{t('sidebar.action.rename', { ns: 'explore' })}</span>
          </DropdownMenuItem>
        )}
        {isShowDelete && (
          <DropdownMenuItem
            variant="destructive"
            className="gap-2 px-2 system-md-regular"
            onClick={(e) => {
              e.stopPropagation()
              handleDeferredAction(onDelete)
            }}
          >
            <span aria-hidden className="i-ri-delete-bin-line h-4 w-4 shrink-0" />
            <span className="grow">{t('sidebar.action.delete', { ns: 'explore' })}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
export default React.memo(Operation)
