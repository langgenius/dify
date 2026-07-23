'use client'
import type { Placement } from '@langgenius/dify-ui/popover'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import useTimestamp from '@/hooks/use-timestamp'
import { useVersionListOfPlugin } from '@/service/use-plugins'
import { isEarlierThanVersion } from '@/utils/semver'

type Props = Readonly<{
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
}>

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
  const format = t(($) => $.dateTimeFormat, { ns: 'appLog' }).split(' ')[0]
  const { formatDate } = useTimestamp()

  const { data: res, isLoading } = useVersionListOfPlugin(pluginID, isShow && !disabled)

  const handleSelect = useCallback(
    ({
      version,
      unique_identifier,
      isDowngrade,
    }: {
      version: string
      unique_identifier: string
      isDowngrade: boolean
    }) => {
      if (currentVersion === version) return
      onSelect({ version, unique_identifier, isDowngrade })
      onShowChange(false)
    },
    [currentVersion, onSelect, onShowChange],
  )

  return (
    <Popover
      open={isShow}
      onOpenChange={(open) => {
        if (!disabled) onShowChange(open)
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
        popupClassName="relative w-[209px] bg-components-panel-bg-blur p-1 backdrop-blur-[5px]"
      >
        <div className="px-3 pt-1 pb-0.5 system-xs-medium-uppercase text-text-tertiary">
          {t(($) => $['detailPanel.switchVersion'], { ns: 'plugin' })}
        </div>
        <div className="relative max-h-[224px] overflow-y-auto">
          {isLoading ? (
            <div
              role="status"
              aria-label={t(($) => $.loading, { ns: 'common' })}
              className="flex h-12 items-center justify-center"
            >
              <span
                aria-hidden
                className="i-ri-loader-2-line size-4 animate-spin text-text-tertiary"
              />
            </div>
          ) : (
            res?.data.versions.map((version) => (
              <button
                key={version.unique_identifier}
                type="button"
                disabled={currentVersion === version.version}
                className={cn(
                  'flex w-full cursor-pointer items-center rounded-lg border-0 px-2 py-1 text-left outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-default disabled:hover:bg-transparent',
                  currentVersion === version.version && 'cursor-default opacity-30',
                )}
                onClick={() =>
                  handleSelect({
                    version: version.version,
                    unique_identifier: version.unique_identifier,
                    isDowngrade: isEarlierThanVersion(version.version, currentVersion),
                  })
                }
              >
                <div className="flex min-h-5 min-w-0 grow items-center gap-1 px-1">
                  <div className="min-w-0 grow truncate system-sm-medium text-text-secondary">
                    {version.version}
                  </div>
                  {currentVersion === version.version && (
                    <Badge className="shrink-0" variant="dimm" text="CURRENT" />
                  )}
                  <div className="shrink-0 system-xs-regular text-text-tertiary">
                    {formatDate(version.created_at, format!)}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default React.memo(PluginVersionPicker)
