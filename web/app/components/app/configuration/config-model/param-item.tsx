'use client'
import type { FC } from 'react'
import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import Slider from '@/app/components/base/slider'
import TagInput from '@/app/components/base/tag-input'

export const getFitPrecisionValue = (num: number, precision: number | null) => {
  if (!precision || !(`${num}`).includes('.'))
    return num

  const currNumPrecision = (`${num}`).split('.')[1].length
  if (currNumPrecision > precision)
    return parseFloat(num.toFixed(precision))

  return num
}

export type IParamIteProps = {
  id: string
  name: string
  tip: string
  value: number | string[]
  step?: number
  min?: number
  max: number
  precision: number | null
  onChange: (key: string, value: number | string[]) => void
  inputType?: 'inputTag' | 'slider'
}

const TIMES_TEMPLATE = '1000000000000'
const ParamItem: FC<IParamIteProps> = ({ id, name, tip, step = 0.1, min = 0, max, precision, value, inputType, onChange }) => {
  const { t } = useTranslation()

  const getToIntTimes = (num: number) => {
    if (precision)
      return parseInt(TIMES_TEMPLATE.slice(0, precision + 1), 10)
    if (num < 5)
      return 10
    return 1
  }

  const times = getToIntTimes(max)

  useEffect(() => {
    if (precision)
      onChange(id, getFitPrecisionValue(value, precision))
  }, [value, precision])
  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col flex-shrink-0">
        <div className="flex items-center">
          <span className="mr-[6px] text-gray-500 text-[13px] font-medium">{name}</span>
          {/* Give tooltip different tip to avoiding hide bug */}
          <Tooltip htmlContent={<div className="w-[200px] whitespace-pre-wrap">{tip}</div>} position='top' selector={`param-name-tooltip-${id}`}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8.66667 10.6667H8V8H7.33333M8 5.33333H8.00667M14 8C14 8.78793 13.8448 9.56815 13.5433 10.2961C13.2417 11.0241 12.7998 11.6855 12.2426 12.2426C11.6855 12.7998 11.0241 13.2417 10.2961 13.5433C9.56815 13.8448 8.78793 14 8 14C7.21207 14 6.43185 13.8448 5.7039 13.5433C4.97595 13.2417 4.31451 12.7998 3.75736 12.2426C3.20021 11.6855 2.75825 11.0241 2.45672 10.2961C2.15519 9.56815 2 8.78793 2 8C2 6.4087 2.63214 4.88258 3.75736 3.75736C4.88258 2.63214 6.4087 2 8 2C9.5913 2 11.1174 2.63214 12.2426 3.75736C13.3679 4.88258 14 6.4087 14 8Z" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Tooltip>
        </div>
        {inputType === 'inputTag' && <div className="text-gray-400 text-xs font-normal">{t('common.model.params.stop_sequencesPlaceholder')}</div>}
      </div>
      <div className="flex items-center">
        {inputType === 'inputTag'
          ? <TagInput
            items={(value ?? []) as string[]}
            onChange={newSequences => onChange(id, newSequences)}
            customizedConfirmKey='Tab'
          />
          : (
            <>
              <div className="mr-4 w-[120px]">
                <Slider value={value * times} min={min * times} max={max * times} onChange={(value) => {
                  onChange(id, value / times)
                }} />
              </div>
              <input type="number" min={min} max={max} step={step} className="block w-[64px] h-9 leading-9 rounded-lg border-0 pl-1 pl py-1.5 bg-gray-50 text-gray-900  placeholder:text-gray-400 focus:ring-1 focus:ring-inset focus:ring-primary-600" value={value} onChange={(e) => {
                let value = getFitPrecisionValue(isNaN(parseFloat(e.target.value)) ? min : parseFloat(e.target.value), precision)
                if (value < min)
                  value = min

                if (value > max)
                  value = max
                onChange(id, value)
              }} />
            </>
          )
        }
      </div>
    </div>
  )
}
export default React.memo(ParamItem)
