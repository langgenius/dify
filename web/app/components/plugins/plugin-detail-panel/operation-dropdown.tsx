'use client'
import type { FC } from 'react'
import React, { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PluginSource } from '../types'
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
  source: PluginSource
  onInfo: () => void
  onCheckVersion: () => void
  onRemove: () => void
  detailUrl: string
}

const OperationDropdown: FC<Props> = ({
  source,
  detailUrl,
  onInfo,
  onCheckVersion,
  onRemove,
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
            <RiMoreFill className='h-4 w-4' />
          </ActionButton>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-50'>
        <div className='bg-components-panel-bg-blur border-components-panel-border w-[160px] rounded-xl border-[0.5px] p-1 shadow-lg'>
          {source === PluginSource.github && (
            <div
              onClick={() => {
                onInfo()
                handleTrigger()
              }}
              className='text-text-secondary system-md-regular hover:bg-state-base-hover cursor-pointer rounded-lg px-3 py-1.5'
            >{t('plugin.detailPanel.operation.info')}</div>
          )}
          {source === PluginSource.github && (
            <div
              onClick={() => {
                onCheckVersion()
                handleTrigger()
              }}
              className='text-text-secondary system-md-regular hover:bg-state-base-hover cursor-pointer rounded-lg px-3 py-1.5'
            >{t('plugin.detailPanel.operation.checkUpdate')}</div>
          )}
          {(source === PluginSource.marketplace || source === PluginSource.github) && (
            <a href={detailUrl} target='_blank' className='text-text-secondary system-md-regular hover:bg-state-base-hover flex cursor-pointer items-center rounded-lg px-3 py-1.5'>
              <span className='grow'>{t('plugin.detailPanel.operation.viewDetail')}</span>
              <RiArrowRightUpLine className='text-text-tertiary h-3.5 w-3.5 shrink-0' />
            </a>
          )}
          {(source === PluginSource.marketplace || source === PluginSource.github) && (
            <div className='bg-divider-subtle my-1 h-px'></div>
          )}
          <div
            onClick={() => {
              onRemove()
              handleTrigger()
            }}
            className='text-text-secondary system-md-regular hover:text-text-destructive hover:bg-state-destructive-hover cursor-pointer rounded-lg px-3 py-1.5'
          >{t('plugin.detailPanel.operation.remove')}</div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(OperationDropdown)
