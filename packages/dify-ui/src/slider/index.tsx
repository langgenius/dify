'use client'

import { Slider as BaseSlider } from '@base-ui/react/slider'
import { cn } from '../cn'
import { formLabelClassName } from '../form-control-shared'

const SliderRoot = BaseSlider.Root

type SliderValue = number
type SliderRangeValue = readonly number[]
type SliderRootValue = SliderValue | SliderRangeValue
type SliderRootProps<Value extends SliderRootValue = SliderRootValue> = BaseSlider.Root.Props<Value>

type SliderLabelProps = Omit<BaseSlider.Label.Props, 'className'> & { className?: string }

function SliderLabel({ className, ...props }: SliderLabelProps) {
  return <BaseSlider.Label className={cn(formLabelClassName, className)} {...props} />
}

const sliderControlClassName = cn(
  'relative flex h-5 w-full touch-none items-center select-none',
  'data-disabled:cursor-not-allowed',
)

type SliderControlProps = Omit<BaseSlider.Control.Props, 'className'> & { className?: string }

function SliderControl({ className, ...props }: SliderControlProps) {
  return <BaseSlider.Control className={cn(sliderControlClassName, className)} {...props} />
}

const sliderTrackClassName = cn(
  'relative h-1 w-full overflow-hidden rounded-full',
  'bg-components-slider-track',
)

type SliderTrackProps = Omit<BaseSlider.Track.Props, 'className'> & { className?: string }

function SliderTrack({ className, ...props }: SliderTrackProps) {
  return <BaseSlider.Track className={cn(sliderTrackClassName, className)} {...props} />
}

const sliderIndicatorClassName = cn('h-full rounded-full', 'bg-components-slider-range')

type SliderIndicatorProps = Omit<BaseSlider.Indicator.Props, 'className'> & {
  className?: string
}

function SliderIndicator({ className, ...props }: SliderIndicatorProps) {
  return <BaseSlider.Indicator className={cn(sliderIndicatorClassName, className)} {...props} />
}

const sliderThumbClassName = cn(
  'block h-5 w-2 shrink-0 rounded-[3px] border-[0.5px]',
  'border-components-slider-knob-border bg-components-slider-knob shadow-sm',
  'transition-[background-color,border-color,box-shadow,opacity] motion-reduce:transition-none',
  'hover:bg-components-slider-knob-hover',
  'has-focus-visible:ring-2 has-focus-visible:ring-state-accent-solid has-focus-visible:ring-offset-0',
  'active:shadow-md',
  'group-data-disabled/slider:border-components-slider-knob-border group-data-disabled/slider:bg-components-slider-knob-disabled group-data-disabled/slider:shadow-none',
)

type SliderThumbProps = Omit<BaseSlider.Thumb.Props, 'className'> & { className?: string }

function SliderThumb({ className, ...props }: SliderThumbProps) {
  return <BaseSlider.Thumb className={cn(sliderThumbClassName, className)} {...props} />
}

type SliderSlotClassNames = {
  control?: string
  track?: string
  indicator?: string
  thumb?: string
}

type SliderBaseProps = Pick<
  SliderRootProps<SliderValue>,
  'onValueChange' | 'min' | 'max' | 'step' | 'disabled' | 'name'
> &
  Pick<SliderThumbProps, 'aria-label' | 'aria-labelledby'> & {
    className?: string
    slotClassNames?: SliderSlotClassNames
  }

type ControlledSliderProps = SliderBaseProps & {
  value: SliderValue
  defaultValue?: never
}

type UncontrolledSliderProps = SliderBaseProps & {
  value?: never
  defaultValue?: SliderValue
}

type SliderProps = ControlledSliderProps | UncontrolledSliderProps

const sliderRootClassName = 'group/slider relative inline-flex w-full data-disabled:opacity-30'

const getSafeValue = (value: number | undefined, min: number) => {
  if (value === undefined) return undefined

  return Number.isFinite(value) ? value : min
}

function Slider({
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
      thumbAlignment="center"
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

export { Slider, SliderControl, SliderIndicator, SliderLabel, SliderRoot, SliderThumb, SliderTrack }

export type {
  SliderControlProps,
  SliderIndicatorProps,
  SliderLabelProps,
  SliderProps,
  SliderRootProps,
  SliderThumbProps,
  SliderTrackProps,
}
