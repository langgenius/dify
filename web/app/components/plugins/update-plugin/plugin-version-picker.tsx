'use client'
import type { Placement } from '@langgenius/dify-ui/popover'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import useTimestamp from '@/hooks/use-timestamp'
import { useVersionListOfPlugin } from '@/service/use-plugins'
import { isEarlierThanVersion } from '@/utils/semver'

type Props = {
  disabled?: boolean
  isShow: boolean
  onShowChange: (isShow: boolean) => void
  pluginID: string
  currentVersion: string
  trigger: React.ReactNode
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
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
  sideOffset = 4,
  alignOffset = 0,
  onSelect,
}) => {
  const { t } = useTranslation()
  const format = t('dateTimeFormat', { ns: 'appLog' }).split(' ')[0]
  const { formatDate } = useTimestamp()

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
    <Popover
      open={isShow}
      onOpenChange={(open) => {
        if (!disabled)
          onShowChange(open)
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        className={cn('inline-flex cursor-pointer items-center', disabled && 'cursor-default')}
      >
        {trigger}
      </PopoverTrigger>

      <PopoverContent
        placement={placement}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        popupClassName="relative w-[209px] bg-components-panel-bg-blur p-1 backdrop-blur-xs"
      >
        <div className="px-3 pt-1 pb-0.5 system-xs-medium-uppercase text-text-tertiary">
          {t('detailPanel.switchVersion', { ns: 'plugin' })}
        </div>
        <div className="relative max-h-[224px] overflow-y-auto">
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
                isDowngrade: isEarlierThanVersion(version.version, currentVersion),
              })}
            >
              <div className="flex grow items-center">
                <div className="system-sm-medium text-text-secondary">{version.version}</div>
                {currentVersion === version.version && <Badge className="ml-1" text="CURRENT" />}
              </div>
              <div className="shrink-0 system-xs-regular text-text-tertiary">{formatDate(version.created_at, format!)}</div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default React.memo(PluginVersionPicker)
