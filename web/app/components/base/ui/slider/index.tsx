'use client'

import { Slider as BaseSlider } from '@base-ui/react/slider'
import { cn } from '@langgenius/dify-ui/cn'

/** @public */
export const SliderRoot = BaseSlider.Root

type SliderRootProps = BaseSlider.Root.Props<number>

const sliderControlClassName = cn(
  'relative flex h-5 w-full touch-none items-center select-none',
  'data-disabled:cursor-not-allowed',
)

type SliderControlProps = BaseSlider.Control.Props

/** @public */
export function SliderControl({ className, ...props }: SliderControlProps) {
  return (
    <BaseSlider.Control
      className={cn(sliderControlClassName, className)}
      {...props}
    />
  )
}

const sliderTrackClassName = cn(
  'relative h-1 w-full overflow-hidden rounded-full',
  'bg-components-slider-track',
)

type SliderTrackProps = BaseSlider.Track.Props

/** @public */
export function SliderTrack({ className, ...props }: SliderTrackProps) {
  return (
    <BaseSlider.Track
      className={cn(sliderTrackClassName, className)}
      {...props}
    />
  )
}

const sliderIndicatorClassName = cn(
  'h-full rounded-full',
  'bg-components-slider-range',
)

type SliderIndicatorProps = BaseSlider.Indicator.Props

/** @public */
export function SliderIndicator({ className, ...props }: SliderIndicatorProps) {
  return (
    <BaseSlider.Indicator
      className={cn(sliderIndicatorClassName, className)}
      {...props}
    />
  )
}

const sliderThumbClassName = cn(
  'block h-5 w-2 shrink-0 rounded-[3px] border-[0.5px]',
  'border-components-slider-knob-border bg-components-slider-knob shadow-sm',
  'transition-[background-color,border-color,box-shadow,opacity] motion-reduce:transition-none',
  'hover:bg-components-slider-knob-hover',
  'focus-visible:ring-2 focus-visible:ring-components-slider-knob-border-hover focus-visible:ring-offset-0 focus-visible:outline-hidden',
  'active:shadow-md',
  'group-data-disabled/slider:border-components-slider-knob-border group-data-disabled/slider:bg-components-slider-knob-disabled group-data-disabled/slider:shadow-none',
)

type SliderThumbProps = BaseSlider.Thumb.Props

/** @public */
export function SliderThumb({ className, ...props }: SliderThumbProps) {
  return (
    <BaseSlider.Thumb
      className={cn(sliderThumbClassName, className)}
      {...props}
    />
  )
}

type SliderSlotClassNames = {
  control?: string
  track?: string
  indicator?: string
  thumb?: string
}

type SliderBaseProps = Pick<
  SliderRootProps,
  'onValueChange' | 'min' | 'max' | 'step' | 'disabled' | 'name'
> & Pick<SliderThumbProps, 'aria-label' | 'aria-labelledby'> & {
  className?: string
  slotClassNames?: SliderSlotClassNames
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
  slotClassNames,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
}: SliderProps) {
  return (
    <SliderRoot
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
      <SliderControl className={slotClassNames?.control}>
        <SliderTrack className={slotClassNames?.track}>
          <SliderIndicator className={slotClassNames?.indicator} />
        </SliderTrack>
        <SliderThumb
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledby}
          className={slotClassNames?.thumb}
        />
      </SliderControl>
    </SliderRoot>
  )
}
