'use client'
import type { FC } from 'react'
import type { Placement } from '@/app/components/base/ui/placement'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'

type Props = {
  title: string
  isPinned: boolean
  isShowRenameConversation?: boolean
  onRenameConversation?: () => void
  isShowDelete: boolean
  togglePin: () => void
  onDelete: () => void
  placement?: Placement
}

const Operation: FC<Props> = ({
  title,
  isPinned,
  togglePin,
  isShowRenameConversation,
  onRenameConversation,
  isShowDelete,
  onDelete,
  placement = 'bottom-start',
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const handleDeferredAction = useCallback((action: () => void) => {
    setOpen(false)
    queueMicrotask(action)
  }, [])

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuTrigger
        render={<div />}
      >
        <div className={cn('flex cursor-pointer items-center rounded-lg p-1.5 pl-2 text-text-secondary hover:bg-state-base-hover', open && 'bg-state-base-hover')}>
          <div className="system-md-semibold">{title}</div>
          <span aria-hidden className="i-ri-arrow-down-s-line h-4 w-4" />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement={placement}
        sideOffset={4}
        popupClassName="min-w-[120px]"
      >
        <DropdownMenuItem className="system-md-regular" onClick={togglePin}>
          <span className="grow">{isPinned ? t('sidebar.action.unpin', { ns: 'explore' }) : t('sidebar.action.pin', { ns: 'explore' })}</span>
        </DropdownMenuItem>
        {isShowRenameConversation && (
          <DropdownMenuItem
            className="system-md-regular"
            onClick={() => onRenameConversation && handleDeferredAction(onRenameConversation)}
          >
            <span className="grow">{t('sidebar.action.rename', { ns: 'explore' })}</span>
          </DropdownMenuItem>
        )}
        {isShowDelete && (
          <DropdownMenuItem
            variant="destructive"
            className="system-md-regular"
            onClick={() => handleDeferredAction(onDelete)}
          >
            <span className="grow">{t('sidebar.action.delete', { ns: 'explore' })}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
export default React.memo(Operation)
