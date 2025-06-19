'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo } from 'react'
import { AUTO_UPDATE_STRATEGY, type AutoUpdateConfig } from './types'
import Label from '../label'
import StrategyPicker from './strategy-picker'
import { useTranslation } from 'react-i18next'

const i18nPrefix = 'plugin.autoUpdate'

type Props = {
  payload: AutoUpdateConfig
  onChange: (payload: AutoUpdateConfig) => void
}

const AutoUpdateSetting: FC<Props> = ({
  payload,
  onChange,
}) => {
  const { t } = useTranslation()
  const { strategy_setting } = payload
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
            </div>
            <div className='flex items-center'>
              <Label label={t(`${i18nPrefix}.specifyPluginsToUpdate`)} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
export default React.memo(AutoUpdateSetting)
