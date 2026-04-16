'use client'

import { Slider as BaseSlider } from '@base-ui/react/slider'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'

type SliderRootProps = BaseSlider.Root.Props<number>
type SliderThumbProps = BaseSlider.Thumb.Props

type SliderBaseProps = Pick<
  SliderRootProps,
  'onValueChange' | 'min' | 'max' | 'step' | 'disabled' | 'name'
> & Pick<SliderThumbProps, 'aria-label' | 'aria-labelledby'> & {
  className?: string
}

type ControlledSliderProps = SliderBaseProps & {
  value: number
  defaultValue?: never
}

type UncontrolledSliderProps = SliderBaseProps & {
  value?: never
  defaultValue?: number
}

type SliderProps = ControlledSliderProps | UncontrolledSliderProps

const sliderRootClassName = 'group/slider relative inline-flex w-full data-disabled:opacity-30'
const sliderControlClassName = cn(
  'relative flex h-5 w-full touch-none items-center select-none',
  'data-disabled:cursor-not-allowed',
)
const sliderTrackClassName = cn(
  'relative h-1 w-full overflow-hidden rounded-full',
  'bg-(--slider-track,var(--color-components-slider-track))',
)
const sliderIndicatorClassName = cn(
  'h-full rounded-full',
  'bg-(--slider-range,var(--color-components-slider-range))',
)
const sliderThumbClassName = cn(
  'block h-5 w-2 shrink-0 rounded-[3px] border-[0.5px]',
  'border-(--slider-knob-border,var(--color-components-slider-knob-border))',
  'bg-(--slider-knob,var(--color-components-slider-knob)) shadow-sm',
  'transition-[background-color,border-color,box-shadow,opacity] motion-reduce:transition-none',
  'hover:bg-(--slider-knob-hover,var(--color-components-slider-knob-hover))',
  'focus-visible:ring-2 focus-visible:ring-components-slider-knob-border-hover focus-visible:ring-offset-0 focus-visible:outline-hidden',
  'active:shadow-md',
  'group-data-disabled/slider:bg-(--slider-knob-disabled,var(--color-components-slider-knob-disabled))',
  'group-data-disabled/slider:border-(--slider-knob-border,var(--color-components-slider-knob-border))',
  'group-data-disabled/slider:shadow-none',
)

const getSafeValue = (value: number | undefined, min: number) => {
  if (value === undefined)
    return undefined

  return Number.isFinite(value) ? value : min
}

export function Slider({
  value,
  defaultValue,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  name,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
}: SliderProps) {
  return (
    <BaseSlider.Root
      value={getSafeValue(value, min)}
      defaultValue={getSafeValue(defaultValue, min)}
      onValueChange={onValueChange}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      name={name}
      thumbAlignment="edge-client-only"
      className={cn(sliderRootClassName, className)}
    >
      <BaseSlider.Control className={sliderControlClassName}>
        <BaseSlider.Track className={sliderTrackClassName}>
          <BaseSlider.Indicator className={sliderIndicatorClassName} />
        </BaseSlider.Track>
        <BaseSlider.Thumb
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledby}
          className={sliderThumbClassName}
        />
      </BaseSlider.Control>
    </BaseSlider.Root>
  )
}
