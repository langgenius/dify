'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import type { Placement } from '@floating-ui/react'
import {
  RiArrowDownSLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import cn from '@/utils/classnames'

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

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement={placement}
      offset={4}
    >
      <PortalToFollowElemTrigger
        onClick={() => setOpen(v => !v)}
      >
        <div className={cn('flex items-center p-1.5 pl-2 rounded-lg text-text-secondary cursor-pointer hover:bg-state-base-hover', open && 'bg-state-base-hover')}>
          <div className='system-md-semibold'>{title}</div>
          <RiArrowDownSLine className='w-4 h-4 ' />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-50">
        <div
          className={'min-w-[120px] p-1 bg-components-panel-bg-blur backdrop-blur-sm rounded-xl border-[0.5px] border-components-panel-border shadow-lg'}
        >
          <div className={cn('flex items-center space-x-1 px-3 py-1.5 rounded-lg text-text-secondary system-md-regular cursor-pointer hover:bg-state-base-hover')} onClick={togglePin}>
            <span className='grow'>{isPinned ? t('explore.sidebar.action.unpin') : t('explore.sidebar.action.pin')}</span>
          </div>
          {isShowRenameConversation && (
            <div className={cn('flex items-center space-x-1 px-3 py-1.5 rounded-lg text-text-secondary system-md-regular cursor-pointer hover:bg-state-base-hover')} onClick={onRenameConversation}>
              <span className='grow'>{t('explore.sidebar.action.rename')}</span>
            </div>
          )}
          {isShowDelete && (
            <div className={cn('group flex items-center space-x-1 px-3 py-1.5 rounded-lg text-text-secondary system-md-regular cursor-pointer hover:bg-state-destructive-hover hover:text-text-destructive')} onClick={onDelete} >
              <span className='grow'>{t('explore.sidebar.action.delete')}</span>
            </div>
          )}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(Operation)
