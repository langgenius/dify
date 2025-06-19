'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import type { AutoUpdateConfig } from './types'
import Label from '../label'
import StrategyPicker from './strategy-picker'

type Props = {
  payload: AutoUpdateConfig
  onChange: (payload: AutoUpdateConfig) => void
}

const AutoUpdateSetting: FC<Props> = ({
  payload,
  onChange,
}) => {
  const { strategy_setting } = payload
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
          <Label label='Automatic updates' />
          <StrategyPicker value={strategy_setting} onChange={handleChange('strategy_setting')} />
        </div>
        <div className='flex items-center justify-between'>
          <Label label='Update time' />
        </div>
        <div className='flex items-center'>
          <Label label='Specify plugins to update' />
        </div>
      </div>
    </div>
  )
}
export default React.memo(AutoUpdateSetting)
