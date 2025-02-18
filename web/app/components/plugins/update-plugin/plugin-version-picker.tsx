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
  }: {
    version: string
    unique_identifier: string
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

  const handleSelect = useCallback(({ version, unique_identifier }: {
    version: string
    unique_identifier: string
  }) => {
    if (currentVersion === version)
      return
    onSelect({ version, unique_identifier })
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
        className={cn('inline-flex items-center cursor-pointer', disabled && 'cursor-default')}
        onClick={handleTriggerClick}
      >
        {trigger}
      </PortalToFollowElemTrigger>

      <PortalToFollowElemContent className='z-[1000]'>
        <div className="relative w-[209px] p-1 rounded-xl bg-components-panel-bg-blur border-[0.5px] border-components-panel-border shadow-lg">
          <div className='px-3 pt-1 pb-0.5 text-text-tertiary system-xs-medium-uppercase'>
            {t('plugin.detailPanel.switchVersion')}
          </div>
          <div className='relative'>
            {res?.data.versions.map(version => (
              <div
                key={version.unique_identifier}
                className={cn(
                  'h-7 px-3 py-1 flex items-center gap-1 rounded-lg hover:bg-state-base-hover cursor-pointer',
                  currentVersion === version.version && 'opacity-30 cursor-default hover:bg-transparent',
                )}
                onClick={() => handleSelect({
                  version: version.version,
                  unique_identifier: version.unique_identifier,
                })}
              >
                <div className='grow flex items-center'>
                  <div className='text-text-secondary system-sm-medium'>{version.version}</div>
                  {currentVersion === version.version && <Badge className='ml-1' text='CURRENT'/>}
                </div>
                <div className='shrink-0 text-text-tertiary system-xs-regular'>{formatDate(version.created_at, format)}</div>
              </div>
            ))}
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default React.memo(PluginVersionPicker)
