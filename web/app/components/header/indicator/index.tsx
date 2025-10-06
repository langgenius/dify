'use client'

import classNames from '@/utils/classnames'

export type IndicatorProps = {
  color?: 'green' | 'orange' | 'red' | 'blue' | 'yellow' | 'gray'
  className?: string
}

export type ColorMap = {
  green: string
  orange: string
  red: string
  blue: string
  yellow: string
  gray: string
}

const BACKGROUND_MAP: ColorMap = {
  green: 'bg-components-badge-status-light-success-bg',
  orange: 'bg-components-badge-status-light-warning-bg',
  red: 'bg-components-badge-status-light-error-bg',
  blue: 'bg-components-badge-status-light-normal-bg',
  yellow: 'bg-components-badge-status-light-warning-bg',
  gray: 'bg-components-badge-status-light-disabled-bg',
}
const BORDER_MAP: ColorMap = {
  green: 'border-components-badge-status-light-success-border-inner',
  orange: 'border-components-badge-status-light-warning-border-inner',
  red: 'border-components-badge-status-light-error-border-inner',
  blue: 'border-components-badge-status-light-normal-border-inner',
  yellow: 'border-components-badge-status-light-warning-border-inner',
  gray: 'border-components-badge-status-light-disabled-border-inner',
}
const SHADOW_MAP: ColorMap = {
  green: 'shadow-status-indicator-green-shadow',
  orange: 'shadow-status-indicator-warning-shadow',
  red: 'shadow-status-indicator-red-shadow',
  blue: 'shadow-status-indicator-blue-shadow',
  yellow: 'shadow-status-indicator-warning-shadow',
  gray: 'shadow-status-indicator-gray-shadow',
}

export default function Indicator({
  color = 'green',
  className = '',
}: IndicatorProps) {
  return (
    <div
      className={classNames(
        'h-2 w-2 rounded-[3px] border border-solid',
        BACKGROUND_MAP[color],
        BORDER_MAP[color],
        SHADOW_MAP[color],
        className,
      )}
    />
  )
}
