'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Badge from '@/app/components/base/badge'
import type {
  OffsetOptions,
  Placement,
} from '@floating-ui/react'
import { useVersionListOfPlugin } from '@/service/use-plugins'
import useTimestamp from '@/hooks/use-timestamp'
import cn from '@/utils/classnames'
import { lt } from 'semver'

type Props = {
  disabled?: boolean
  isShow: boolean
  onShowChange: (isShow: boolean) => void
  pluginID: string
  currentVersion: string
  trigger: React.ReactNode
  placement?: Placement
  offset?: OffsetOptions
  onSelect: ({
    version,
    unique_identifier,
    isDowngrade,
  }: {
    version: string
    unique_identifier: string
    isDowngrade: boolean
  }) => void
}

const PluginVersionPicker: FC<Props> = ({
  disabled = false,
  isShow,
  onShowChange,
  pluginID,
  currentVersion,
  trigger,
  placement = 'bottom-start',
  offset = {
    mainAxis: 4,
    crossAxis: -16,
  },
  onSelect,
}) => {
  const { t } = useTranslation()
  const format = t('appLog.dateTimeFormat').split(' ')[0]
  const { formatDate } = useTimestamp()

  const handleTriggerClick = () => {
    if (disabled) return
    onShowChange(true)
  }

  const { data: res } = useVersionListOfPlugin(pluginID)

  const handleSelect = useCallback(({ version, unique_identifier, isDowngrade }: {
    version: string
    unique_identifier: string
    isDowngrade: boolean
  }) => {
    if (currentVersion === version)
      return
    onSelect({ version, unique_identifier, isDowngrade })
    onShowChange(false)
  }, [currentVersion, onSelect, onShowChange])

  return (
    <PortalToFollowElem
      placement={placement}
      offset={offset}
      open={isShow}
      onOpenChange={onShowChange}
    >
      <PortalToFollowElemTrigger
        className={cn('inline-flex cursor-pointer items-center', disabled && 'cursor-default')}
        onClick={handleTriggerClick}
      >
        {trigger}
      </PortalToFollowElemTrigger>

      <PortalToFollowElemContent className='z-[1000]'>
        <div className="relative w-[209px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-sm">
          <div className='system-xs-medium-uppercase px-3 pb-0.5 pt-1 text-text-tertiary'>
            {t('plugin.detailPanel.switchVersion')}
          </div>
          <div className='relative'>
            {res?.data.versions.map(version => (
              <div
                key={version.unique_identifier}
                className={cn(
                  'flex h-7 cursor-pointer items-center gap-1 rounded-lg px-3 py-1 hover:bg-state-base-hover',
                  currentVersion === version.version && 'cursor-default opacity-30 hover:bg-transparent',
                )}
                onClick={() => handleSelect({
                  version: version.version,
                  unique_identifier: version.unique_identifier,
                  isDowngrade: lt(version.version, currentVersion),
                })}
              >
                <div className='flex grow items-center'>
                  <div className='system-sm-medium text-text-secondary'>{version.version}</div>
                  {currentVersion === version.version && <Badge className='ml-1' text='CURRENT'/>}
                </div>
                <div className='system-xs-regular shrink-0 text-text-tertiary'>{formatDate(version.created_at, format)}</div>
              </div>
            ))}
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default React.memo(PluginVersionPicker)
