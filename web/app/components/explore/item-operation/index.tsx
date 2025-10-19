'use client'
import type { FC } from 'react'
import React, { useEffect, useRef, useState } from 'react'
import {
  RiDeleteBinLine,
  RiEditLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import { Pin02 } from '../../base/icons/src/vender/line/general'

import s from './style.module.css'
import cn from '@/utils/classnames'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'

export type IItemOperationProps = {
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
        <div className={cn(className, s.btn, 'h-6 w-6 rounded-md border-none py-1', (isItemHovering || open) && `${s.open} !bg-components-actionbar-bg !shadow-none`)}></div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent
        className="z-50"
      >
        <div
          ref={ref}
          className={'min-w-[120px] rounded-lg border border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]'}
          onMouseEnter={setIsHovering}
          onMouseLeave={setNotHovering}
          onClick={(e) => {
            e.stopPropagation()
          }}
        >
          <div className={cn(s.actionItem, 'group hover:bg-state-base-hover')} onClick={togglePin}>
            <Pin02 className='h-4 w-4 shrink-0 text-text-secondary' />
            <span className={s.actionName}>{isPinned ? t('explore.sidebar.action.unpin') : t('explore.sidebar.action.pin')}</span>
          </div>
          {isShowRenameConversation && (
            <div className={cn(s.actionItem, 'group hover:bg-state-base-hover')} onClick={onRenameConversation}>
              <RiEditLine className='h-4 w-4 shrink-0 text-text-secondary' />
              <span className={s.actionName}>{t('explore.sidebar.action.rename')}</span>
            </div>
          )}
          {isShowDelete && (
            <div className={cn(s.actionItem, s.deleteActionItem, 'group hover:bg-state-base-hover')} onClick={onDelete} >
              <RiDeleteBinLine className={cn(s.deleteActionItemChild, 'h-4 w-4 shrink-0 stroke-current stroke-2 text-text-secondary')} />
              <span className={cn(s.actionName, s.deleteActionItemChild)}>{t('explore.sidebar.action.delete')}</span>
            </div>
          )}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(ItemOperation)
