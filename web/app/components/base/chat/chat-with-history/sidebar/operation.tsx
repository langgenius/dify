'use client'
import type { FC } from 'react'
import {
  RiDeleteBinLine,
  RiEditLine,
  RiMoreFill,
  RiPushpinLine,
  RiUnpinLine,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'

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
  const ref = useRef(null)
  const [isHovering, { setTrue: setIsHovering, setFalse: setNotHovering }] = useBoolean(false)
  useEffect(() => {
    if (!isItemHovering && !isHovering)
      setOpen(false)
  }, [isItemHovering, isHovering])
  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      offset={4}
    >
      <PortalToFollowElemTrigger
        onClick={() => setOpen(v => !v)}
      >
        <ActionButton
          className={cn((isItemHovering || open) ? 'opacity-100' : 'opacity-0')}
          state={
            isActive
              ? ActionButtonState.Active
              : open
                ? ActionButtonState.Hover
                : ActionButtonState.Default
          }
        >
          <RiMoreFill className="h-4 w-4" />
        </ActionButton>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-50">
        <div
          ref={ref}
          className="min-w-[120px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-sm"
          onMouseEnter={setIsHovering}
          onMouseLeave={setNotHovering}
          onClick={(e) => {
            e.stopPropagation()
          }}
        >
          <div className={cn('system-md-regular flex cursor-pointer items-center space-x-1 rounded-lg px-2 py-1.5 text-text-secondary hover:bg-state-base-hover')} onClick={togglePin}>
            {isPinned && <RiUnpinLine className="h-4 w-4 shrink-0 text-text-tertiary" />}
            {!isPinned && <RiPushpinLine className="h-4 w-4 shrink-0 text-text-tertiary" />}
            <span className="grow">{isPinned ? t('sidebar.action.unpin', { ns: 'explore' }) : t('sidebar.action.pin', { ns: 'explore' })}</span>
          </div>
          {isShowRenameConversation && (
            <div className={cn('system-md-regular flex cursor-pointer items-center space-x-1 rounded-lg px-2 py-1.5 text-text-secondary hover:bg-state-base-hover')} onClick={onRenameConversation}>
              <RiEditLine className="h-4 w-4 shrink-0 text-text-tertiary" />
              <span className="grow">{t('sidebar.action.rename', { ns: 'explore' })}</span>
            </div>
          )}
          {isShowDelete && (
            <div className={cn('system-md-regular group flex cursor-pointer items-center space-x-1 rounded-lg px-2 py-1.5 text-text-secondary hover:bg-state-destructive-hover hover:text-text-destructive')} onClick={onDelete}>
              <RiDeleteBinLine className={cn('h-4 w-4 shrink-0 text-text-tertiary group-hover:text-text-destructive')} />
              <span className="grow">{t('sidebar.action.delete', { ns: 'explore' })}</span>
            </div>
          )}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(Operation)
