import type { NumberFieldRoot as BaseNumberFieldRoot } from '@base-ui/react/number-field'
import type { FC } from 'react'
import type { InputProps } from '../input'
import { useCallback } from 'react'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
  NumberFieldUnit,
} from '@/app/components/base/ui/number-field'
import { cn } from '@/utils/classnames'

export type InputNumberProps = {
  unit?: string
  value?: number
  onChange: (value: number) => void
  amount?: number
  size?: 'regular' | 'large'
  max?: number
  min?: number
  defaultValue?: number
  disabled?: boolean
  wrapClassName?: string
  controlWrapClassName?: string
  controlClassName?: string
} & Omit<InputProps, 'value' | 'onChange' | 'size' | 'min' | 'max' | 'defaultValue'>

const isValueWithinBounds = (value: number, min?: number, max?: number) => {
  if (typeof min === 'number' && value < min)
    return false

  if (typeof max === 'number' && value > max)
    return false

  return true
}

export const InputNumber: FC<InputNumberProps> = (props) => {
  const {
    unit,
    className,
    onChange,
    amount,
    value,
    size = 'regular',
    max,
    min,
    defaultValue,
    wrapClassName,
    controlWrapClassName,
    controlClassName,
    disabled,
    step,
    id,
    name,
    readOnly,
    required,
    type: _type,
    ...rest
  } = props

  const resolvedStep = amount ?? (step === 'any' || typeof step === 'number' ? step : undefined) ?? 1
  const stepAmount = typeof resolvedStep === 'number' ? resolvedStep : 1

  const handleValueChange = useCallback((
    nextValue: number | null,
    eventDetails: BaseNumberFieldRoot.ChangeEventDetails,
  ) => {
    if (
      value === undefined
      && (eventDetails.reason === 'increment-press' || eventDetails.reason === 'decrement-press')
    ) {
      onChange(defaultValue ?? 0)
      return
    }

    if (nextValue === null) {
      onChange(0)
      return
    }

    if (
      typeof value === 'number'
      && eventDetails.reason === 'increment-press'
      && typeof max === 'number'
      && value + stepAmount > max
    ) {
      return
    }

    if (
      typeof value === 'number'
      && eventDetails.reason === 'decrement-press'
      && typeof min === 'number'
      && value - stepAmount < min
    ) {
      return
    }

    if (!isValueWithinBounds(nextValue, min, max))
      return

    onChange(nextValue)
  }, [defaultValue, max, min, onChange, stepAmount, value])

  return (
    <div data-testid="input-number-wrapper" className={cn('flex w-full min-w-0', wrapClassName)}>
      <NumberField
        className="min-w-0 grow"
        value={value ?? null}
        min={min}
        max={max}
        step={resolvedStep}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        id={id}
        name={name}
        allowOutOfRange
        onValueChange={handleValueChange}
      >
        <NumberFieldGroup size={size}>
          <NumberFieldInput
            {...rest}
            size={size}
            className={className}
            role="spinbutton"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value}
          />
          {unit && (
            <NumberFieldUnit size={size}>
              {unit}
            </NumberFieldUnit>
          )}
          <NumberFieldControls
            data-testid="input-number-controls"
            className={controlWrapClassName}
          >
            <NumberFieldIncrement
              aria-label="increment"
              size={size}
              className={controlClassName}
            >
              <span aria-hidden="true" className="i-ri-arrow-up-s-line size-3" />
            </NumberFieldIncrement>
            <NumberFieldDecrement
              aria-label="decrement"
              size={size}
              className={controlClassName}
            >
              <span aria-hidden="true" className="i-ri-arrow-down-s-line size-3" />
            </NumberFieldDecrement>
          </NumberFieldControls>
        </NumberFieldGroup>
      </NumberField>
    </div>
  )
}
