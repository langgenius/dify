'use client'

import { Slider as BaseSlider } from '@base-ui/react/slider'
import { cn } from '../cn'
import { formLabelClassName } from '../form-control-shared'

type SliderValue = number | readonly number[]
type SliderProps<Value extends SliderValue = SliderValue> = Omit<
  BaseSlider.Root.Props<Value>,
  'className'
> & { className?: string }

function Slider<Value extends SliderValue = SliderValue>({
  className,
  ...props
}: SliderProps<Value>) {
  return (
    <BaseSlider.Root
      className={cn(
        'group/slider relative inline-flex w-full data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
        'data-disabled:opacity-30',
        className,
      )}
      {...props}
    />
  )
}

type SliderLabelProps = Omit<BaseSlider.Label.Props, 'className'> & { className?: string }

function SliderLabel({ className, ...props }: SliderLabelProps) {
  return <BaseSlider.Label className={cn(formLabelClassName, className)} {...props} />
}

type SliderControlProps = Omit<BaseSlider.Control.Props, 'className'> & { className?: string }

function SliderControl({ className, ...props }: SliderControlProps) {
  return (
    <BaseSlider.Control
      className={cn(
        'relative flex h-5 w-full touch-none items-center select-none',
        'data-[orientation=vertical]:h-32 data-[orientation=vertical]:w-5 data-[orientation=vertical]:justify-center',
        'data-disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    />
  )
}

type SliderTrackProps = Omit<BaseSlider.Track.Props, 'className'> & { className?: string }

function SliderTrack({ className, ...props }: SliderTrackProps) {
  return (
    <BaseSlider.Track
      className={cn(
        'relative h-1 w-full rounded-full',
        'data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1',
        'bg-components-slider-track',
        className,
      )}
      {...props}
    />
  )
}

type SliderIndicatorProps = Omit<BaseSlider.Indicator.Props, 'className'> & {
  className?: string
}

function SliderIndicator({ className, ...props }: SliderIndicatorProps) {
  return (
    <BaseSlider.Indicator
      className={cn('h-full rounded-full', 'bg-components-slider-range', className)}
      {...props}
    />
  )
}

type SliderThumbProps = Omit<BaseSlider.Thumb.Props, 'className'> & { className?: string }

function SliderThumb({ className, ...props }: SliderThumbProps) {
  return (
    <BaseSlider.Thumb
      className={cn(
        'block h-5 w-2 shrink-0 rounded-[3px] border-[0.5px]',
        'data-[orientation=vertical]:h-2 data-[orientation=vertical]:w-5',
        'border-components-slider-knob-border bg-components-slider-knob shadow-sm',
        'transition-[background-color,border-color,box-shadow,opacity] motion-reduce:transition-none',
        'hover:bg-components-slider-knob-hover',
        'has-focus-visible:ring-2 has-focus-visible:ring-state-accent-solid has-focus-visible:ring-offset-0',
        'active:shadow-md group-data-dragging/slider:has-focus:shadow-md',
        'data-disabled:border-components-slider-knob-border data-disabled:bg-components-slider-knob-disabled data-disabled:shadow-none',
        className,
      )}
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
