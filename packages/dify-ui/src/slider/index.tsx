'use client'

import { Slider as BaseSlider } from '@base-ui/react/slider'
import { cn } from '../cn'
import { formLabelClassName } from '../form-control-shared'
import { resolveClassName } from '../internals/resolve-class-name'

type SliderValue = number | readonly number[]
type SliderProps<Value extends SliderValue = SliderValue> = BaseSlider.Root.Props<Value>

function Slider<Value extends SliderValue = SliderValue>({
  className,
  ...props
}: SliderProps<Value>) {
  return (
    <BaseSlider.Root
      className={(state) =>
        cn(
          'group/slider relative inline-flex w-full data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
          'data-disabled:opacity-30',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type SliderLabelProps = BaseSlider.Label.Props

function SliderLabel({ className, ...props }: SliderLabelProps) {
  return (
    <BaseSlider.Label
      className={(state) => cn(formLabelClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type SliderControlProps = BaseSlider.Control.Props

function SliderControl({ className, ...props }: SliderControlProps) {
  return (
    <BaseSlider.Control
      className={(state) =>
        cn(
          'relative flex h-5 w-full touch-none items-center select-none',
          'data-[orientation=vertical]:h-32 data-[orientation=vertical]:w-5 data-[orientation=vertical]:justify-center',
          'data-disabled:cursor-not-allowed',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type SliderTrackProps = BaseSlider.Track.Props

function SliderTrack({ className, ...props }: SliderTrackProps) {
  return (
    <BaseSlider.Track
      className={(state) =>
        cn(
          'relative h-1 w-full rounded-full',
          'data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1',
          'bg-components-slider-track',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type SliderIndicatorProps = BaseSlider.Indicator.Props

function SliderIndicator({ className, ...props }: SliderIndicatorProps) {
  return (
    <BaseSlider.Indicator
      className={(state) =>
        cn('h-full rounded-full', 'bg-components-slider-range', resolveClassName(className, state))
      }
      {...props}
    />
  )
}

type SliderThumbProps = BaseSlider.Thumb.Props

function SliderThumb({ className, ...props }: SliderThumbProps) {
  return (
    <BaseSlider.Thumb
      className={(state) =>
        cn(
          'block h-5 w-2 shrink-0 rounded-[3px] border-[0.5px]',
          'data-[orientation=vertical]:h-2 data-[orientation=vertical]:w-5',
          'border-components-slider-knob-border bg-components-slider-knob shadow-sm',
          'transition-[background-color,border-color,box-shadow,opacity] motion-reduce:transition-none',
          'hover:bg-components-slider-knob-hover',
          'has-focus-visible:ring-2 has-focus-visible:ring-state-accent-solid has-focus-visible:ring-offset-0',
          'active:shadow-md group-data-dragging/slider:has-focus:shadow-md',
          'data-disabled:border-components-slider-knob-border data-disabled:bg-components-slider-knob-disabled data-disabled:shadow-none',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

export { Slider, SliderControl, SliderIndicator, SliderLabel, SliderThumb, SliderTrack }

export type {
  SliderControlProps,
  SliderIndicatorProps,
  SliderLabelProps,
  SliderProps,
  SliderThumbProps,
  SliderTrackProps,
}
