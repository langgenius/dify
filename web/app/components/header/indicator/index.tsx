'use client'

import classNames from '@/utils/classnames'

export type IndicatorProps = {
  color?: 'green' | 'orange' | 'red' | 'blue' | 'yellow' | 'gray'
  className?: string
}

type ColorMap = {
  green: string
  orange: string
  red: string
  blue: string
  yellow: string
  gray: string
}

const BACKGROUND_MAP: ColorMap = {
  green: 'bg-[#31C48D]',
  orange: 'bg-[#FF5A1F]',
  red: 'bg-[#F04438]',
  blue: 'bg-[#36BFFA]',
  yellow: 'bg-[#FDB022]',
  gray: 'bg-[#D0D5DD]',
}
const BORDER_MAP: ColorMap = {
  green: 'border-[#0E9F6E]',
  orange: 'border-[#D03801]',
  red: 'border-[#D92D20]',
  blue: 'border-[#0BA5EC]',
  yellow: 'border-[#F79009]',
  gray: 'border-[#98A2B3]',
}
const SHADOW_MAP: ColorMap = {
  green: 'shadow-[0_0_5px_-3px_rgba(14,159,110,0.1),0.5px_0.5px_3px_rgba(14,159,110,0.3),inset_1.5px_1.5px_0px_rgba(255,255,255,0.2)]',
  orange: 'shadow-[0_0_5px_-3px_rgba(255,90,31,0.2),0.5px_0.5px_3px_rgba(255, 90, 31, 0.3), inset_1.5px_1.5px_0_rgba(255, 255, 255, 0.2)]',
  red: 'shadow-[0_0_5px_-3px_rgba(249,112,102,0.1),0.5px_0.5px_3px_rgba(249, 112, 102, 0.2), inset_1.5px_1.5px_0_rgba(255, 255, 255, 0.4)]',
  blue: 'shadow-[0_0_5px_-3px_rgba(208, 213, 221, 0.1),0.5px_0.5px_3px_rgba(208, 213, 221, 0.3), inset_1.5px_1.5px_0_rgba(255, 255, 255, 0.2)]',
  yellow: 'shadow-[0_0_5px_-3px_rgba(253, 176, 34, 0.1),0.5px_0.5px_3px_rgba(253, 176, 34, 0.3), inset_1.5px_1.5px_0_rgba(255, 255, 255, 0.2)]',
  gray: 'shadow-[0_0_5px_-3px_rgba(208, 213, 221, 0.1),0.5px_0.5px_3px_rgba(208, 213, 221, 0.3), inset_1.5px_1.5px_0_rgba(255, 255, 255, 0.2)]',
}

export default function Indicator({
  color = 'green',
  className = '',
}: IndicatorProps) {
  return (
    <div className={classNames(
      'w-2 h-2 border border-solid rounded-[3px]',
      BACKGROUND_MAP[color],
      BORDER_MAP[color],
      SHADOW_MAP[color],
      className,
    )}>

    </div>
  )
}
