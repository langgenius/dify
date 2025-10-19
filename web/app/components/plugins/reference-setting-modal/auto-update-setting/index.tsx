'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo } from 'react'
import { AUTO_UPDATE_MODE, AUTO_UPDATE_STRATEGY, type AutoUpdateConfig } from './types'
import Label from '../label'
import StrategyPicker from './strategy-picker'
import { Trans, useTranslation } from 'react-i18next'
import TimePicker from '@/app/components/base/date-and-time-picker/time-picker'
import OptionCard from '@/app/components/workflow/nodes/_base/components/option-card'
import PluginsPicker from './plugins-picker'
import { convertLocalSecondsToUTCDaySeconds, convertUTCDaySecondsToLocalSeconds, dayjsToTimeOfDay, timeOfDayToDayjs } from './utils'
import { useAppContext } from '@/context/app-context'
import type { TriggerParams } from '@/app/components/base/date-and-time-picker/types'
import { RiTimeLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import { convertTimezoneToOffsetStr } from '@/app/components/base/date-and-time-picker/utils/dayjs'
import { useModalContextSelector } from '@/context/modal-context'

const i18nPrefix = 'plugin.autoUpdate'

type Props = {
  payload: AutoUpdateConfig
  onChange: (payload: AutoUpdateConfig) => void
}

const SettingTimeZone: FC<{
  children?: React.ReactNode
}> = ({
  children,
}) => {
  const setShowAccountSettingModal = useModalContextSelector(s => s.setShowAccountSettingModal)
  return (
    <span className='body-xs-regular cursor-pointer text-text-accent' onClick={() => setShowAccountSettingModal({ payload: 'language' })} >{children}</span>
  )
}
const AutoUpdateSetting: FC<Props> = ({
  payload,
  onChange,
}) => {
  const { t } = useTranslation()
  const { userProfile: { timezone } } = useAppContext()

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
        return t(`${i18nPrefix}.strategy.fixOnly.selectedDescription`)
      case AUTO_UPDATE_STRATEGY.latest:
        return t(`${i18nPrefix}.strategy.latest.selectedDescription`)
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
      <div
        className='group float-right flex h-8 w-[160px] cursor-pointer items-center justify-between rounded-lg bg-components-input-bg-normal px-2 hover:bg-state-base-hover-alt'
        onClick={onClick}
      >
        <div className='flex w-0 grow items-center gap-x-1'>
          <RiTimeLine className={cn(
            'h-4 w-4 shrink-0 text-text-tertiary',
            isOpen ? 'text-text-secondary' : 'group-hover:text-text-secondary',
          )} />
          {inputElem}
        </div>
        <div className='system-sm-regular text-text-tertiary'>{convertTimezoneToOffsetStr(timezone)}</div>
      </div>
    )
  }, [timezone])

  return (
    <div className='self-stretch px-6'>
      <div className='my-3 flex items-center'>
        <div className='system-xs-medium-uppercase text-text-tertiary'>{t(`${i18nPrefix}.updateSettings`)}</div>
        <div className='ml-2 h-px grow bg-divider-subtle'></div>
      </div>

      <div className='space-y-4'>
        <div className='flex items-center justify-between'>
          <Label label={t(`${i18nPrefix}.automaticUpdates`)} description={strategyDescription} />
          <StrategyPicker value={strategy_setting} onChange={handleChange('strategy_setting')} />
        </div>
        {strategy_setting !== AUTO_UPDATE_STRATEGY.disabled && (
          <>
            <div className='flex items-center justify-between'>
              <Label label={t(`${i18nPrefix}.updateTime`)} />
              <div className='flex flex-col justify-start'>
                <TimePicker
                  value={timeOfDayToDayjs(convertUTCDaySecondsToLocalSeconds(upgrade_time_of_day, timezone!))}
                  timezone={timezone}
                  onChange={v => handleChange('upgrade_time_of_day')(convertLocalSecondsToUTCDaySeconds(dayjsToTimeOfDay(v), timezone!))}
                  onClear={() => handleChange('upgrade_time_of_day')(convertLocalSecondsToUTCDaySeconds(0, timezone!))}
                  popupClassName='z-[99]'
                  title={t(`${i18nPrefix}.updateTime`)}
                  minuteFilter={minuteFilter}
                  renderTrigger={renderTimePickerTrigger}
                />
                <div className='body-xs-regular mt-1 text-right text-text-tertiary'>
                  <Trans
                    i18nKey={`${i18nPrefix}.changeTimezone`}
                    components={{
                      setTimezone: <SettingTimeZone />,
                    }}
                  />
                </div>
              </div>
            </div>
            <div>
              <Label label={t(`${i18nPrefix}.specifyPluginsToUpdate`)} />
              <div className='mt-1 flex w-full items-start justify-between gap-2'>
                {[AUTO_UPDATE_MODE.update_all, AUTO_UPDATE_MODE.exclude, AUTO_UPDATE_MODE.partial].map(option => (
                  <OptionCard
                    key={option}
                    title={t(`${i18nPrefix}.upgradeMode.${option}`)}
                    onSelect={() => handleChange('upgrade_mode')(option)}
                    selected={upgrade_mode === option}
                    className="flex-1"
                  />
                ))}
              </div>

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
