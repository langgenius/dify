'use client'
import type { FC } from 'react'
import { InputNumber } from '../input-number'
import Tooltip from '@/app/components/base/tooltip'
import Slider from '@/app/components/base/slider'
import Switch from '@/app/components/base/switch'

type Props = {
  className?: string
  id: string
  name: string
  noTooltip?: boolean
  tip?: string
  value: number
  enable: boolean
  step?: number
  min?: number
  max: number
  onChange: (key: string, value: number) => void
  hasSwitch?: boolean
  onSwitchChange?: (key: string, enable: boolean) => void
}

const ParamItem: FC<Props> = ({ className, id, name, noTooltip, tip, step = 0.1, min = 0, max, value, enable, onChange, hasSwitch, onSwitchChange }) => {
  return (
    <div className={className}>
      <div className="flex items-center justify-between">
        <div className="flex items-center h-6">
          {hasSwitch && (
            <Switch
              size='md'
              className='mr-2'
              defaultValue={enable}
              onChange={async (val) => {
                onSwitchChange?.(id, val)
              }}
            />
          )}
          <span className="mr-1 text-text-secondary system-sm-semibold">{name}</span>
          {!noTooltip && (
            <Tooltip
              triggerClassName='w-4 h-4 shrink-0'
              popupContent={<div className="w-[200px]">{tip}</div>}
            />
          )}
        </div>
      </div>
      <div className="mt-1 flex items-center">
        <div className="mr-3 flex shrink-0 items-center">
          <InputNumber
            disabled={!enable}
            type="number"
            min={min}
            max={max}
            step={step}
            size='sm'
            value={value}
            onChange={(value) => {
              onChange(id, value)
            }}
            className='w-[72px]'
          />
        </div>
        <div className="flex items-center grow">
          <Slider
            className='w-full'
            disabled={!enable}
            value={max < 5 ? value * 100 : value}
            min={min < 1 ? min * 100 : min}
            max={max < 5 ? max * 100 : max}
            onChange={value => onChange(id, value / (max < 5 ? 100 : 1))}
          />
        </div>
      </div>
    </div>
  )
}
export default ParamItem
