'use client'
import type { FC } from 'react'
import type { AutoUpdateConfig } from './types'
import type { TriggerParams } from '@/app/components/base/date-and-time-picker/types'
import { cn } from '@langgenius/dify-ui/cn'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { RiTimeLine } from '@remixicon/react'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import { Trans } from 'react-i18next'
import { useTranslation } from '#i18n'
import TimePicker from '@/app/components/base/date-and-time-picker/time-picker'
import { convertTimezoneToOffsetStr } from '@/app/components/base/date-and-time-picker/utils/dayjs'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useModalContextSelector } from '@/context/modal-context'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import Label from '../label'
import PluginsPicker from './plugins-picker'
import StrategyPicker from './strategy-picker'
import { AUTO_UPDATE_MODE, AUTO_UPDATE_STRATEGY } from './types'
import { convertLocalSecondsToUTCDaySeconds, convertUTCDaySecondsToLocalSeconds, dayjsToTimeOfDay, timeOfDayToDayjs } from './utils'

const i18nPrefix = 'autoUpdate'

type Props = Readonly<{
  payload: AutoUpdateConfig
  onChange: (payload: AutoUpdateConfig) => void
}>

const SettingTimeZone: FC<{
  children?: React.ReactNode
}> = ({
  children,
}) => {
  const setShowAccountSettingModal = useModalContextSelector(s => s.setShowAccountSettingModal)
  return (
    <button
      type="button"
      className="cursor-pointer border-none bg-transparent p-0 text-left body-xs-regular text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
      onClick={() => setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.PREFERENCES })}
    >
      {children}
    </button>
  )
}
const AutoUpdateSetting: FC<Props> = ({
  payload,
  onChange,
}) => {
  const { t } = useTranslation()
  const { data: timezone } = useQuery({
    ...userProfileQueryOptions(),
    select: data => data.profile.timezone ?? undefined,
  })

  const {
    strategy_setting,
    upgrade_time_of_day,
    upgrade_mode,
    exclude_plugins,
    include_plugins,
  } = payload

  const minuteFilter = useCallback((minutes: string[]) => {
    return minutes.filter((m) => {
      const time = Number.parseInt(m, 10)
      return time % 15 === 0
    })
  }, [])
  const strategyDescription = useMemo(() => {
    switch (strategy_setting) {
      case AUTO_UPDATE_STRATEGY.fixOnly:
        return t(`${i18nPrefix}.strategy.fixOnly.selectedDescription`, { ns: 'plugin' })
      case AUTO_UPDATE_STRATEGY.latest:
        return t(`${i18nPrefix}.strategy.latest.selectedDescription`, { ns: 'plugin' })
      default:
        return ''
    }
  }, [strategy_setting, t])

  const plugins = useMemo(() => {
    switch (upgrade_mode) {
      case AUTO_UPDATE_MODE.partial:
        return include_plugins
      case AUTO_UPDATE_MODE.exclude:
        return exclude_plugins
      default:
        return []
    }
  }, [upgrade_mode, exclude_plugins, include_plugins])
  const scopeOptions = useMemo(() => [
    {
      value: AUTO_UPDATE_MODE.update_all,
      label: t(`${i18nPrefix}.upgradeMode.${AUTO_UPDATE_MODE.update_all}`, { ns: 'plugin' }),
    },
    {
      value: AUTO_UPDATE_MODE.exclude,
      label: t(`${i18nPrefix}.upgradeMode.${AUTO_UPDATE_MODE.exclude}`, { ns: 'plugin' }),
    },
    {
      value: AUTO_UPDATE_MODE.partial,
      label: t(`${i18nPrefix}.upgradeMode.${AUTO_UPDATE_MODE.partial}`, { ns: 'plugin' }),
    },
  ], [t])

  const handlePluginsChange = useCallback((newPlugins: string[]) => {
    if (upgrade_mode === AUTO_UPDATE_MODE.partial) {
      onChange({
        ...payload,
        include_plugins: newPlugins,
      })
    }
    else if (upgrade_mode === AUTO_UPDATE_MODE.exclude) {
      onChange({
        ...payload,
        exclude_plugins: newPlugins,
      })
    }
  }, [payload, upgrade_mode, onChange])
  const handleChange = useCallback((key: keyof AutoUpdateConfig) => {
    return (value: AutoUpdateConfig[keyof AutoUpdateConfig]) => {
      onChange({
        ...payload,
        [key]: value,
      })
    }
  }, [payload, onChange])

  const renderTimePickerTrigger = useCallback(({ inputElem, onClick, isOpen }: TriggerParams) => {
    return (
      <button
        type="button"
        className="group flex h-8 w-[160px] cursor-pointer items-center justify-between rounded-lg border-none bg-components-input-bg-normal px-2 text-left hover:bg-state-base-hover-alt focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
        onClick={onClick}
      >
        <div className="flex w-0 grow items-center gap-x-1">
          <RiTimeLine className={cn(
            'size-4 shrink-0 text-text-tertiary',
            isOpen ? 'text-text-secondary' : 'group-hover:text-text-secondary',
          )}
          />
          {inputElem}
        </div>
        <div className="system-sm-regular text-text-tertiary">{convertTimezoneToOffsetStr(timezone)}</div>
      </button>
    )
  }, [timezone])

  return (
    <div className="self-stretch px-6">
      <div className="my-3 flex items-center">
        <div className="system-xs-medium-uppercase text-text-tertiary">{t(`${i18nPrefix}.updateSettings`, { ns: 'plugin' })}</div>
        <div className="ml-2 h-px grow bg-divider-subtle"></div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label label={t(`${i18nPrefix}.automaticUpdates`, { ns: 'plugin' })} description={strategyDescription} />
          <StrategyPicker value={strategy_setting} onChange={handleChange('strategy_setting')} />
        </div>
        {strategy_setting !== AUTO_UPDATE_STRATEGY.disabled && (
          <>
            <div className="flex items-center justify-between">
              <Label label={t(`${i18nPrefix}.updateTime`, { ns: 'plugin' })} />
              <div className="flex flex-col items-end">
                <TimePicker
                  value={timeOfDayToDayjs(convertUTCDaySecondsToLocalSeconds(upgrade_time_of_day, timezone!))}
                  timezone={timezone}
                  onChange={v => handleChange('upgrade_time_of_day')(convertLocalSecondsToUTCDaySeconds(dayjsToTimeOfDay(v), timezone!))}
                  onClear={() => handleChange('upgrade_time_of_day')(convertLocalSecondsToUTCDaySeconds(0, timezone!))}
                  title={t(`${i18nPrefix}.updateTime`, { ns: 'plugin' })}
                  minuteFilter={minuteFilter}
                  renderTrigger={renderTimePickerTrigger}
                  placement="bottom-end"
                />
                <div className="mt-1 text-right body-xs-regular text-text-tertiary">
                  <Trans
                    i18nKey={`${i18nPrefix}.changeTimezone`}
                    ns="plugin"
                    components={{
                      setTimezone: <SettingTimeZone />,
                    }}
                  />
                </div>
              </div>
            </div>
            <div>
              <Label label={t(`${i18nPrefix}.specifyPluginsToUpdate`, { ns: 'plugin' })} />
              <SegmentedControl<AUTO_UPDATE_MODE>
                aria-label={t(`${i18nPrefix}.specifyPluginsToUpdate`, { ns: 'plugin' })}
                className="mt-1 flex w-full"
                value={[upgrade_mode]}
                onValueChange={(nextValue) => {
                  const selectedValue = nextValue[0]
                  if (selectedValue)
                    handleChange('upgrade_mode')(selectedValue)
                }}
              >
                {scopeOptions.map(option => (
                  <SegmentedControlItem<AUTO_UPDATE_MODE>
                    key={option.value}
                    value={option.value}
                    className="flex-1 hover:bg-state-base-hover-alt data-pressed:text-text-accent-light-mode-only data-pressed:hover:bg-components-segmented-control-item-active-bg"
                  >
                    <span className="p-0.5 whitespace-nowrap">{option.label}</span>
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>

              {upgrade_mode !== AUTO_UPDATE_MODE.update_all && (
                <PluginsPicker
                  value={plugins}
                  onChange={handlePluginsChange}
                  updateMode={upgrade_mode}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
export default React.memo(AutoUpdateSetting)
