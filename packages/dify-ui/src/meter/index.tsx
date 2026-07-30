'use client'

/**
 * Meter — a graphical display of a numeric value within a known range
 * (quota usage, capacity, scores). For task-completion semantics use a
 * Progress primitive instead; `role="meter"` and `role="progressbar"` are
 * not interchangeable.
 *
 * Consumers import from `@langgenius/dify-ui/meter` and must NOT import
 * `@base-ui/react/meter` directly.
 */

import type { VariantProps } from 'class-variance-authority'
import { Meter as BaseMeter } from '@base-ui/react/meter'
import { cva } from 'class-variance-authority'
import { cn } from '../cn'

const Meter = BaseMeter.Root
type MeterProps = BaseMeter.Root.Props

const meterTrackClassName =
  'relative block h-1 w-full overflow-hidden rounded-md bg-components-progress-bar-bg'

type MeterTrackProps = Omit<BaseMeter.Track.Props, 'className'> & {
  className?: string
}

function MeterTrack({ className, ...props }: MeterTrackProps) {
  return <BaseMeter.Track className={cn(meterTrackClassName, className)} {...props} />
}

const meterIndicatorVariants = cva(
  'block h-full rounded-md transition-[width] motion-reduce:transition-none',
  {
    variants: {
      tone: {
        neutral: 'bg-components-progress-bar-progress-solid',
        warning: 'bg-components-progress-warning-progress',
        error: 'bg-components-progress-error-progress',
      },
    },
    defaultVariants: {
      tone: 'neutral',
    },
  },
)

type MeterTone = NonNullable<VariantProps<typeof meterIndicatorVariants>['tone']>

type MeterIndicatorProps = Omit<BaseMeter.Indicator.Props, 'className'> & {
  className?: string
  tone?: MeterTone
}

function MeterIndicator({ className, tone, ...props }: MeterIndicatorProps) {
  return (
    <BaseMeter.Indicator className={cn(meterIndicatorVariants({ tone }), className)} {...props} />
  )
}

const meterValueClassName = 'system-xs-regular text-text-tertiary tabular-nums'
type MeterValueProps = Omit<BaseMeter.Value.Props, 'className'> & {
  className?: string
}

function MeterValue({ className, ...props }: MeterValueProps) {
  return <BaseMeter.Value className={cn(meterValueClassName, className)} {...props} />
}

const meterLabelClassName = 'system-xs-medium text-text-tertiary'
type MeterLabelProps = Omit<BaseMeter.Label.Props, 'className'> & {
  className?: string
}

function MeterLabel({ className, ...props }: MeterLabelProps) {
  return <BaseMeter.Label className={cn(meterLabelClassName, className)} {...props} />
}

export { Meter, MeterIndicator, MeterLabel, MeterTrack, MeterValue }
export type {
  MeterIndicatorProps,
  MeterLabelProps,
  MeterProps,
  MeterTone,
  MeterTrackProps,
  MeterValueProps,
}
