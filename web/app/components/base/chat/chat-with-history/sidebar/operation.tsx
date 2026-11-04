'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@langgenius/dify-ui/menu'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

type Props = Readonly<{
  isActive?: boolean
  isItemHovering?: boolean
  isPinned: boolean
  isShowRenameConversation?: boolean
  onRenameConversation?: () => void
  isShowDelete: boolean
  togglePin: () => void
  onDelete: () => void
}>

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
  const { t } = useTranslation(['common', 'explore'])
  const handleDeferredAction = useCallback((action?: () => void) => {
    if (!action) return
    queueMicrotask(action)
  }, [])
  return (
    <Menu modal={false}>
      <MenuTrigger
        render={
          <IconButton
            aria-label={t(($) => $['operation.more'], { ns: 'common' })}
            data-active={isActive ? '' : undefined}
            className={cn(
              'pointer-events-none opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100 data-active:bg-state-accent-active data-active:text-text-accent data-active:hover:bg-state-accent-active-alt data-popup-open:pointer-events-auto data-popup-open:bg-state-base-hover data-popup-open:opacity-100 data-active:data-popup-open:bg-state-accent-active data-active:data-popup-open:text-text-accent',
              isItemHovering && 'pointer-events-auto opacity-100',
            )}
          >
            <span aria-hidden className="i-ri-more-fill size-4" />
          </IconButton>
        }
        onClick={(e) => e.stopPropagation()}
      />
      <MenuContent align="end" className="min-w-30" onClick={(e) => e.stopPropagation()}>
        <MenuItem
          className="gap-2 px-2 system-md-regular"
          onClick={(e) => {
            e.stopPropagation()
            togglePin()
          }}
        >
          {isPinned && (
            <span aria-hidden className="i-ri-unpin-line size-4 shrink-0 text-text-tertiary" />
          )}
          {!isPinned && (
            <span aria-hidden className="i-ri-pushpin-line size-4 shrink-0 text-text-tertiary" />
          )}
          <span className="grow">
            {isPinned
              ? t(($) => $['sidebar.action.unpin'], { ns: 'explore' })
              : t(($) => $['sidebar.action.pin'], { ns: 'explore' })}
          </span>
        </MenuItem>
        {isShowRenameConversation && (
          <MenuItem
            className="gap-2 px-2 system-md-regular"
            onClick={(e) => {
              e.stopPropagation()
              handleDeferredAction(onRenameConversation)
            }}
          >
            <span aria-hidden className="i-ri-edit-line size-4 shrink-0 text-text-tertiary" />
            <span className="grow">{t(($) => $['sidebar.action.rename'], { ns: 'explore' })}</span>
          </MenuItem>
        )}
        {isShowDelete && (
          <MenuItem
            variant="destructive"
            className="gap-2 px-2 system-md-regular"
            onClick={(e) => {
              e.stopPropagation()
              handleDeferredAction(onDelete)
            }}
          >
            <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
            <span className="grow">{t(($) => $['sidebar.action.delete'], { ns: 'explore' })}</span>
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  )
}
export default React.memo(Operation)
