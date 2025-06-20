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
import { useGlobalPublicStore } from '@/context/global-public-context'

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

  const { enable_marketplace } = useGlobalPublicStore(s => s.systemFeatures)

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
        <div className='w-[160px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg'>
          {source === PluginSource.github && (
            <div
              onClick={() => {
                onInfo()
                handleTrigger()
              }}
              className='system-md-regular cursor-pointer rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-base-hover'
            >{t('plugin.detailPanel.operation.info')}</div>
          )}
          {source === PluginSource.github && (
            <div
              onClick={() => {
                onCheckVersion()
                handleTrigger()
              }}
              className='system-md-regular cursor-pointer rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-base-hover'
            >{t('plugin.detailPanel.operation.checkUpdate')}</div>
          )}
          {(source === PluginSource.marketplace || source === PluginSource.github) && enable_marketplace && (
            <a href={detailUrl} target='_blank' className='system-md-regular flex cursor-pointer items-center rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-base-hover'>
              <span className='grow'>{t('plugin.detailPanel.operation.viewDetail')}</span>
              <RiArrowRightUpLine className='h-3.5 w-3.5 shrink-0 text-text-tertiary' />
            </a>
          )}
          {(source === PluginSource.marketplace || source === PluginSource.github) && enable_marketplace && (
            <div className='my-1 h-px bg-divider-subtle'></div>
          )}
          <div
            onClick={() => {
              onRemove()
              handleTrigger()
            }}
            className='system-md-regular cursor-pointer rounded-lg px-3 py-1.5 text-text-secondary hover:bg-state-destructive-hover hover:text-text-destructive'
          >{t('plugin.detailPanel.operation.remove')}</div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(OperationDropdown)
