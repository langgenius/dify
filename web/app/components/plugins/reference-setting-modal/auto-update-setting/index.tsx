'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo } from 'react'
import { AUTO_UPDATE_MODE, AUTO_UPDATE_STRATEGY, type AutoUpdateConfig } from './types'
import Label from '../label'
import StrategyPicker from './strategy-picker'
import { useTranslation } from 'react-i18next'
import TimePicker from '@/app/components/base/date-and-time-picker/time-picker'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import OptionCard from '@/app/components/workflow/nodes/_base/components/option-card'

const i18nPrefix = 'plugin.autoUpdate'

const timeOfDayToDayjs = (timeOfDay: number): Dayjs => {
  const hours = Math.floor(timeOfDay / 3600)
  const minutes = (timeOfDay - hours * 3600) / 60
  const res = dayjs().startOf('day').hour(hours).minute(minutes)
  return res
}

const dayjsToTimeOfDay = (date?: Dayjs): number => {
  if(!date) return 0
  return date.hour() * 3600 + date.minute() * 60
}

type Props = {
  payload: AutoUpdateConfig
  onChange: (payload: AutoUpdateConfig) => void
}

const AutoUpdateSetting: FC<Props> = ({
  payload,
  onChange,
}) => {
  const { t } = useTranslation()
  const {
    strategy_setting,
    upgrade_time_of_day,
    upgrade_mode,
  } = payload
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
  const handleChange = useCallback((key: keyof AutoUpdateConfig) => {
    return (value: AutoUpdateConfig[keyof AutoUpdateConfig]) => {
      onChange({
        ...payload,
        [key]: value,
      })
    }
  }, [payload, onChange])
  return (
    <div className='self-stretch px-6'>
      <div className='my-3 flex items-center'>
        <div className='system-xs-medium-uppercase text-text-tertiary'>Updates Settings</div>
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
              <TimePicker
                value={timeOfDayToDayjs(upgrade_time_of_day)}
                onChange={v => handleChange('upgrade_time_of_day')(dayjsToTimeOfDay(v))}
                onClear={() => handleChange('upgrade_time_of_day')(0)}
                popupClassName='z-[99]'
                title={t(`${i18nPrefix}.updateTime`)}
              />
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
            </div>
          </>
        )}
      </div>
    </div>
  )
}
export default React.memo(AutoUpdateSetting)
