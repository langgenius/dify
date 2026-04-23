'use client'
import type { FC } from 'react'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@langgenius/dify-ui/number-field'
import { Slider } from '@langgenius/dify-ui/slider'
import { Switch } from '@langgenius/dify-ui/switch'
import { Infotip } from '@/app/components/base/infotip'

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
        <div className="flex h-6 items-center">
          {hasSwitch && (
            <Switch
              size="md"
              className="mr-2"
              checked={enable}
              onCheckedChange={async (val) => {
                onSwitchChange?.(id, val)
              }}
            />
          )}
          <span className="mr-1 system-sm-semibold text-text-secondary">{name}</span>
          {!noTooltip && tip && (
            <Infotip aria-label={tip} popupClassName="w-[200px]">
              {tip}
            </Infotip>
          )}
        </div>
      </div>
      <div className="mt-1 flex items-center">
        <div className="mr-3 flex shrink-0 items-center">
          <NumberField
            disabled={!enable}
            min={min}
            max={max}
            step={step}
            value={value}
            onValueChange={nextValue => onChange(id, nextValue ?? min)}
          >
            <NumberFieldGroup>
              <NumberFieldInput className="w-[72px]" />
              <NumberFieldControls>
                <NumberFieldIncrement />
                <NumberFieldDecrement />
              </NumberFieldControls>
            </NumberFieldGroup>
          </NumberField>
        </div>
        <div className="flex grow items-center">
          <Slider
            className="w-full"
            disabled={!enable}
            value={max < 5 ? value * 100 : value}
            min={min < 1 ? min * 100 : min}
            max={max < 5 ? max * 100 : max}
            onValueChange={value => onChange(id, value / (max < 5 ? 100 : 1))}
            aria-label={name}
          />
        </div>
      </div>
    </div>
  )
}
export default ParamItem
