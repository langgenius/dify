'use client'

import type { VariantProps } from 'class-variance-authority'
import { Progress as BaseProgress } from '@base-ui/react/progress'
import { cva } from 'class-variance-authority'
import { cn } from '../cn'

const progressCircleRootVariants = cva(
  'inline-flex shrink-0 items-center justify-center',
  {
    variants: {
      size: {
        small: 'size-3',
        medium: 'size-4',
        large: 'size-5',
      },
    },
    defaultVariants: {
      size: 'small',
    },
  },
)

const progressCircleColorClasses = {
  gray: {
    stroke: 'stroke-components-progress-gray-border',
    fill: 'fill-components-progress-gray-bg',
    sector: 'fill-components-progress-gray-progress',
  },
  white: {
    stroke: 'stroke-components-progress-white-border',
    fill: 'fill-components-progress-white-bg',
    sector: 'fill-components-progress-white-progress',
  },
  blue: {
    stroke: 'stroke-components-progress-brand-border',
    fill: 'fill-components-progress-brand-bg',
    sector: 'fill-components-progress-brand-progress',
  },
  warning: {
    stroke: 'stroke-components-progress-warning-border',
    fill: 'fill-components-progress-warning-bg',
    sector: 'fill-components-progress-warning-progress',
  },
  error: {
    stroke: 'stroke-components-progress-error-border',
    fill: 'fill-components-progress-error-bg',
    sector: 'fill-components-progress-error-progress',
  },
} as const

export type ProgressCircleSize = NonNullable<VariantProps<typeof progressCircleRootVariants>['size']>
export type ProgressCircleColor = keyof typeof progressCircleColorClasses

const progressCircleSizeValues = {
  small: 12,
  medium: 16,
  large: 20,
} as const satisfies Record<ProgressCircleSize, number>

type ProgressCircleAccessibleNameProps
  = | {
    'aria-label': string
    'aria-labelledby'?: never
  }
  | {
    'aria-label'?: never
    'aria-labelledby': string
  }

export type ProgressCircleProps
  = Omit<BaseProgress.Root.Props, 'children' | 'className' | 'aria-label' | 'aria-labelledby'>
    & ProgressCircleAccessibleNameProps
    & {
      className?: string
      color?: ProgressCircleColor
      size?: ProgressCircleSize
      circleStrokeWidth?: number
    }

function getProgressPercentage(value: number | null, min: number, max: number) {
  if (value === null || !Number.isFinite(value) || max <= min)
    return null

  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
}

function getSectorPath(size: number, percentage: number | null) {
  if (percentage === null || percentage <= 0)
    return ''

  const radius = size / 2
  const center = size / 2

  if (percentage >= 100) {
    return `
      M ${center},${center - radius}
      A ${radius},${radius} 0 1 1 ${center},${center + radius}
      A ${radius},${radius} 0 1 1 ${center},${center - radius}
      Z
    `
  }

  const angle = (percentage / 100) * 360
  const radians = (angle * Math.PI) / 180
  const x = center + radius * Math.cos(radians - Math.PI / 2)
  const y = center + radius * Math.sin(radians - Math.PI / 2)
  const largeArcFlag = percentage > 50 ? 1 : 0

  return `
    M ${center},${center}
    L ${center},${center - radius}
    A ${radius},${radius} 0 ${largeArcFlag} 1 ${x},${y}
    Z
  `
}

export function ProgressCircle({
  className,
  color = 'blue',
  size = 'small',
  circleStrokeWidth = 1,
  value,
  min = 0,
  max = 100,
  ...props
}: ProgressCircleProps) {
  const numericSize = progressCircleSizeValues[size]
  const percentage = getProgressPercentage(value, min, max)
  const radius = numericSize / 2
  const center = numericSize / 2
  const pathData = getSectorPath(numericSize, percentage)
  const colors = progressCircleColorClasses[color]

  return (
    <BaseProgress.Root
      className={cn(progressCircleRootVariants({ size }), className)}
      value={value}
      min={min}
      max={max}
      {...props}
    >
      <svg
        width={numericSize + circleStrokeWidth}
        height={numericSize + circleStrokeWidth}
        viewBox={`0 0 ${numericSize + circleStrokeWidth} ${numericSize + circleStrokeWidth}`}
        aria-hidden="true"
        className="block"
      >
        <circle
          className={cn(colors.fill, colors.stroke)}
          cx={center + circleStrokeWidth / 2}
          cy={center + circleStrokeWidth / 2}
          r={radius}
          strokeWidth={circleStrokeWidth}
        />
        {pathData && (
          <path
            className={colors.sector}
            d={pathData}
            transform={`translate(${circleStrokeWidth / 2}, ${circleStrokeWidth / 2})`}
          />
        )}
      </svg>
    </BaseProgress.Root>
  )
}
