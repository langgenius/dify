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

/** @public */
export const MeterRoot = BaseMeter.Root
export type MeterRootProps = BaseMeter.Root.Props

const meterTrackClassName
  = 'relative block h-1 w-full overflow-hidden rounded-md bg-components-progress-bar-bg'

export type MeterTrackProps = BaseMeter.Track.Props

/** @public */
export function MeterTrack({ className, ...props }: MeterTrackProps) {
  return (
    <BaseMeter.Track
      className={cn(meterTrackClassName, className)}
      {...props}
    />
  )
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

export type MeterTone = NonNullable<VariantProps<typeof meterIndicatorVariants>['tone']>

export type MeterIndicatorProps = BaseMeter.Indicator.Props & {
  tone?: MeterTone
}

/** @public */
export function MeterIndicator({ className, tone, ...props }: MeterIndicatorProps) {
  return (
    <BaseMeter.Indicator
      className={cn(meterIndicatorVariants({ tone }), className)}
      {...props}
    />
  )
}

const meterValueClassName = 'system-xs-regular text-text-tertiary tabular-nums'
export type MeterValueProps = BaseMeter.Value.Props

/** @public */
export function MeterValue({ className, ...props }: MeterValueProps) {
  return (
    <BaseMeter.Value
      className={cn(meterValueClassName, className)}
      {...props}
    />
  )
}

const meterLabelClassName = 'system-xs-medium text-text-tertiary'
export type MeterLabelProps = BaseMeter.Label.Props

/** @public */
export function MeterLabel({ className, ...props }: MeterLabelProps) {
  return (
    <BaseMeter.Label
      className={cn(meterLabelClassName, className)}
      {...props}
    />
  )
}

const DEFAULT_WARNING_AT = 80
const DEFAULT_ERROR_AT = 100

type ThresholdToneOptions = {
  warningAt?: number
  errorAt?: number
}

/**
 * Pure mapping from a percent (0..100) to a `MeterTone`. The single place
 * threshold policy lives; keeps UI primitives free of business rules.
 *
 * @example
 *   const tone = getThresholdTone((usage / total) * 100)
 *   <MeterRoot value={usage} max={total} aria-label="Vector space">
 *     <MeterTrack><MeterIndicator tone={tone} /></MeterTrack>
 *   </MeterRoot>
 */
export function getThresholdTone(
  percent: number,
  {
    warningAt = DEFAULT_WARNING_AT,
    errorAt = DEFAULT_ERROR_AT,
  }: ThresholdToneOptions = {},
): MeterTone {
  if (!Number.isFinite(percent))
    return 'neutral'
  if (percent >= errorAt)
    return 'error'
  if (percent >= warningAt)
    return 'warning'
  return 'neutral'
}
