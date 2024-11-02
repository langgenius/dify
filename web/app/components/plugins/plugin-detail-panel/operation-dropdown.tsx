'use client'
import type { FC } from 'react'
import React, { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowRightUpLine, RiMoreFill } from '@remixicon/react'
import ActionButton from '@/app/components/base/action-button'
// import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import cn from '@/utils/classnames'

type Props = {
  onInfo: () => void
  onCheckVersion: () => void
  onRemove: () => void
  detailUrl: string
}

const OperationDropdown: FC<Props> = ({
  onInfo,
  onCheckVersion,
  onRemove,
  detailUrl,
}) => {
  const { t } = useTranslation()
  const [open, doSetOpen] = useState(false)
  const openRef = useRef(open)
  const setOpen = useCallback((v: boolean) => {
    doSetOpen(v)
    openRef.current = v
  }, [doSetOpen])

  const handleTrigger = useCallback(() => {
    setOpen(!openRef.current)
  }, [setOpen])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: -12,
        crossAxis: 36,
      }}
    >
      <PortalToFollowElemTrigger onClick={handleTrigger}>
        <div>
          <ActionButton className={cn(open && 'bg-state-base-hover')}>
            <RiMoreFill className='w-4 h-4' />
          </ActionButton>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-50'>
        <div className='w-[160px] p-1 bg-components-panel-bg-blur rounded-xl border-[0.5px] border-components-panel-border shadow-lg'>
          <div
            onClick={() => {
              onInfo()
              handleTrigger()
            }}
            className='px-3 py-1.5 rounded-lg text-text-secondary system-md-regular cursor-pointer hover:bg-state-base-hover'
          >{t('plugin.detailPanel.operation.info')}</div>
          <div
            onClick={() => {
              onCheckVersion()
              handleTrigger()
            }}
            className='px-3 py-1.5 rounded-lg text-text-secondary system-md-regular cursor-pointer hover:bg-state-base-hover'
          >{t('plugin.detailPanel.operation.checkUpdate')}</div>
          <a href={detailUrl} target='_blank' className='flex items-center px-3 py-1.5 rounded-lg text-text-secondary system-md-regular cursor-pointer hover:bg-state-base-hover'>
            <span className='grow'>{t('plugin.detailPanel.operation.viewDetail')}</span>
            <RiArrowRightUpLine className='shrink-0 w-3.5 h-3.5 text-text-tertiary' />
          </a>
          <div className='my-1 h-px bg-divider-subtle'></div>
          <div
            onClick={() => {
              onRemove()
              handleTrigger()
            }}
            className='px-3 py-1.5 rounded-lg text-text-secondary system-md-regular cursor-pointer hover:text-text-destructive hover:bg-state-destructive-hover'
          >{t('plugin.detailPanel.operation.remove')}</div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(OperationDropdown)
