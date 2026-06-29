'use client'
import type { Placement } from '@langgenius/dify-ui/dropdown-menu'
import type { FC } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import * as React from 'react'
import { useTranslation } from '#i18n'

type Props = Readonly<{
  title: string
  isPinned: boolean
  isShowRenameConversation?: boolean
  onRenameConversation?: () => void
  isShowDelete: boolean
  togglePin: () => void
  onDelete: () => void
  placement?: Placement
}>

const deferAction = (action: () => void) => {
  queueMicrotask(action)
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex cursor-pointer items-center rounded-lg border-none bg-transparent p-1.5 pl-2 text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-base-hover"
      >
        <span className="system-md-semibold">{title}</span>
        <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
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
            onClick={() => onRenameConversation && deferAction(onRenameConversation)}
          >
            <span className="grow">{t('sidebar.action.rename', { ns: 'explore' })}</span>
          </DropdownMenuItem>
        )}
        {isShowDelete && (
          <DropdownMenuItem
            variant="destructive"
            className="system-md-regular"
            onClick={() => deferAction(onDelete)}
          >
            <span className="grow">{t('sidebar.action.delete', { ns: 'explore' })}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
export default React.memo(Operation)
