'use client'
import type { FC } from 'react'
import React, { useEffect, useRef, useState } from 'react'
import {
  RiDeleteBinLine,
  RiEditLine,
  RiMoreFill,
  RiPushpinLine,
  RiUnpinLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import cn from '@/utils/classnames'

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
      placement='bottom-end'
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
          <RiMoreFill className='w-4 h-4' />
        </ActionButton>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-50">
        <div
          ref={ref}
          className={'min-w-[120px] p-1 bg-components-panel-bg-blur backdrop-blur-sm rounded-xl border-[0.5px] border-components-panel-border shadow-lg'}
          onMouseEnter={setIsHovering}
          onMouseLeave={setNotHovering}
          onClick={(e) => {
            e.stopPropagation()
          }}
        >
          <div className={cn('flex items-center space-x-1 px-2 py-1.5 rounded-lg text-text-secondary system-md-regular cursor-pointer hover:bg-state-base-hover')} onClick={togglePin}>
            {isPinned && <RiUnpinLine className='shrink-0 w-4 h-4 text-text-tertiary' />}
            {!isPinned && <RiPushpinLine className='shrink-0 w-4 h-4 text-text-tertiary' />}
            <span className='grow'>{isPinned ? t('explore.sidebar.action.unpin') : t('explore.sidebar.action.pin')}</span>
          </div>
          {isShowRenameConversation && (
            <div className={cn('flex items-center space-x-1 px-2 py-1.5 rounded-lg text-text-secondary system-md-regular cursor-pointer hover:bg-state-base-hover')} onClick={onRenameConversation}>
              <RiEditLine className='shrink-0 w-4 h-4 text-text-tertiary' />
              <span className='grow'>{t('explore.sidebar.action.rename')}</span>
            </div>
          )}
          {isShowDelete && (
            <div className={cn('group flex items-center space-x-1 px-2 py-1.5 rounded-lg text-text-secondary system-md-regular cursor-pointer hover:bg-state-destructive-hover hover:text-text-destructive')} onClick={onDelete} >
              <RiDeleteBinLine className={cn('shrink-0 w-4 h-4 text-text-tertiary group-hover:text-text-destructive')} />
              <span className='grow'>{t('explore.sidebar.action.delete')}</span>
            </div>
          )}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(Operation)
