'use client'
import type { FC } from 'react'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@langgenius/dify-ui/menu'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type Props = Readonly<{
  title: string
  isPinned: boolean
  isShowRenameConversation?: boolean
  onRenameConversation?: () => void
  isShowDelete: boolean
  togglePin: () => void
  onDelete: () => void
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
}) => {
  const { t } = useTranslation(['explore'])

  return (
    <Menu>
      <MenuTrigger className="flex cursor-pointer items-center rounded-lg border-none bg-transparent p-1.5 pl-2 text-text-secondary hover:bg-state-base-hover data-popup-open:bg-state-base-hover">
        <span className="system-md-semibold">{title}</span>
        <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
      </MenuTrigger>
      <MenuContent align="start" className="min-w-30">
        <MenuItem className="system-md-regular" onClick={togglePin}>
          <span className="grow">
            {isPinned
              ? t(($) => $['sidebar.action.unpin'], { ns: 'explore' })
              : t(($) => $['sidebar.action.pin'], { ns: 'explore' })}
          </span>
        </MenuItem>
        {isShowRenameConversation && (
          <MenuItem
            className="system-md-regular"
            onClick={() => onRenameConversation && deferAction(onRenameConversation)}
          >
            <span className="grow">{t(($) => $['sidebar.action.rename'], { ns: 'explore' })}</span>
          </MenuItem>
        )}
        {isShowDelete && (
          <MenuItem
            variant="destructive"
            className="system-md-regular"
            onClick={() => deferAction(onDelete)}
          >
            <span className="grow">{t(($) => $['sidebar.action.delete'], { ns: 'explore' })}</span>
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  )
}
export default React.memo(Operation)
