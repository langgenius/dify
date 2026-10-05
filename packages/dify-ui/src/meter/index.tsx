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
import { resolveClassName } from '../internals/resolve-class-name'

const Meter = BaseMeter.Root
type MeterProps = BaseMeter.Root.Props

const meterTrackClassName =
  'relative block h-1 w-full overflow-hidden rounded-md bg-components-progress-bar-bg'

type MeterTrackProps = BaseMeter.Track.Props

function MeterTrack({ className, ...props }: MeterTrackProps) {
  return (
    <BaseMeter.Track
      className={(state) => cn(meterTrackClassName, resolveClassName(className, state))}
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

type MeterTone = NonNullable<VariantProps<typeof meterIndicatorVariants>['tone']>

type MeterIndicatorProps = BaseMeter.Indicator.Props & {
  tone?: MeterTone
}

function MeterIndicator({ className, tone, ...props }: MeterIndicatorProps) {
  return (
    <BaseMeter.Indicator
      className={(state) =>
        cn(meterIndicatorVariants({ tone }), resolveClassName(className, state))
      }
      {...props}
    />
  )
}

const meterValueClassName = 'system-xs-regular text-text-tertiary tabular-nums'
type MeterValueProps = BaseMeter.Value.Props

function MeterValue({ className, ...props }: MeterValueProps) {
  return (
    <BaseMeter.Value
      className={(state) => cn(meterValueClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

const meterLabelClassName = 'system-xs-medium text-text-tertiary'
type MeterLabelProps = BaseMeter.Label.Props

function MeterLabel({ className, ...props }: MeterLabelProps) {
  return (
    <BaseMeter.Label
      className={(state) => cn(meterLabelClassName, resolveClassName(className, state))}
      {...props}
    />
  )
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
