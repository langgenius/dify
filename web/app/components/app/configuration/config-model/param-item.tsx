'use client'
import type { FC } from 'react'
import React from 'react'
import Tooltip from '@/app/components/base/tooltip'
import Slider from '@/app/components/base/slider'

export type IParamIteProps = {
  id: number
  name: string
  tip: string
  value: number
  step?: number
  min?: number
  max: number
  onChange: (id: number, value: number) => void
}

const ParamIte: FC<IParamIteProps> = ({ id, name, tip, step = 0.1, min = 0, max, value, onChange }) => {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center">
        <span className="mr-[6px]">{name}</span>
        {/* Give tooltip different tip to avoiding hide bug */}
        <Tooltip htmlContent={<div className="w-[200px]">{tip}</div>} position='top' selector={`param-name-tooltip-${id}`}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8.66667 10.6667H8V8H7.33333M8 5.33333H8.00667M14 8C14 8.78793 13.8448 9.56815 13.5433 10.2961C13.2417 11.0241 12.7998 11.6855 12.2426 12.2426C11.6855 12.7998 11.0241 13.2417 10.2961 13.5433C9.56815 13.8448 8.78793 14 8 14C7.21207 14 6.43185 13.8448 5.7039 13.5433C4.97595 13.2417 4.31451 12.7998 3.75736 12.2426C3.20021 11.6855 2.75825 11.0241 2.45672 10.2961C2.15519 9.56815 2 8.78793 2 8C2 6.4087 2.63214 4.88258 3.75736 3.75736C4.88258 2.63214 6.4087 2 8 2C9.5913 2 11.1174 2.63214 12.2426 3.75736C13.3679 4.88258 14 6.4087 14 8Z" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Tooltip>
      </div>
      <div className="flex items-center">
        <div className="mr-4 w-[120px]">
          <Slider value={max < 5 ? value * 10 : value} min={min < 0 ? min * 10 : min} max={max < 5 ? max * 10 : max} onChange={value => onChange(id, value / (max < 5 ? 10 : 1))} />
        </div>
        <input type="number" min={min} max={max} step={step} className="block w-[64px] h-9 leading-9 rounded-lg border-0 pl-1 pl py-1.5 bg-gray-50 text-gray-900  placeholder:text-gray-400 focus:ring-1 focus:ring-inset focus:ring-primary-600" value={value} onChange={(e) => {
          const value = parseFloat(e.target.value)
          if (value < 0 || value > max)
            return

          onChange(id, value)
        }} />
      </div>
    </div>
  )
}
export default React.memo(ParamIte)
