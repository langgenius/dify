'use client'
import type { FC } from 'react'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'

import Tooltip from '@/app/components/base/tooltip-plus'
import Slider from '@/app/components/base/slider'
import Switch from '@/app/components/base/switch'

type Props = {
  id: string
  name: string
  tip: string
  value: number
  enable: boolean
  step?: number
  min?: number
  max: number
  onChange: (key: string, value: number) => void
  hasSwitch?: boolean
  onSwitchChange?: (key: string, enable: boolean) => void
}

const ParamItem: FC<Props> = ({ id, name, tip, step = 0.1, min = 0, max, value, enable, onChange, hasSwitch, onSwitchChange }) => {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          {hasSwitch && (
            <Switch
              size='md'
              defaultValue={enable}
              onChange={async (val) => {
                onSwitchChange?.(id, val)
              }}
            />
          )}
          <span className="mx-1 text-gray-800 text-[13px] leading-[18px] font-medium">{name}</span>
          <Tooltip popupContent={<div className="w-[200px]">{tip}</div>}>
            <HelpCircle className='w-[14px] h-[14px] text-gray-400' />
          </Tooltip>
        </div>
        <div className="flex items-center"></div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center h-7">
          <div className="w-[148px]">
            <Slider
              disabled={!enable}
              value={max < 5 ? value * 100 : value}
              min={min < 1 ? min * 100 : min}
              max={max < 5 ? max * 100 : max}
              onChange={value => onChange(id, value / (max < 5 ? 100 : 1))}
            />
          </div>
        </div>
        <div className="flex items-center">
          <input disabled={!enable} type="number" min={min} max={max} step={step} className="block w-[48px] h-7 text-xs leading-[18px] rounded-lg border-0 pl-1 pl py-1.5 bg-gray-50 text-gray-900  placeholder:text-gray-400 focus:ring-1 focus:ring-inset focus:ring-primary-600 disabled:opacity-60" value={value} onChange={(e) => {
            const value = parseFloat(e.target.value)
            if (value < min || value > max)
              return

            onChange(id, value)
          }} />
        </div>
      </div>
    </div>
  )
}
export default ParamItem
