import type { NumberFieldRoot as BaseNumberFieldRoot } from '@base-ui/react/number-field'
import type { CSSProperties, FC, InputHTMLAttributes } from 'react'
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

type InputNumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'defaultValue' | 'max' | 'min' | 'onChange' | 'size' | 'type' | 'value'
>

export type InputNumberProps = InputNumberInputProps & {
  unit?: string
  value?: number
  onChange: (value: number) => void
  amount?: number
  size?: 'regular' | 'large'
  max?: number
  min?: number
  step?: number | 'any'
  defaultValue?: number
  disabled?: boolean
  wrapClassName?: string
  wrapperClassName?: string
  styleCss?: CSSProperties
  controlWrapClassName?: string
  controlClassName?: string
  type?: 'number'
}

const STEPPER_REASONS = new Set<BaseNumberFieldRoot.ChangeEventDetails['reason']>([
  'increment-press',
  'decrement-press',
])

const isValueWithinBounds = (value: number, min?: number, max?: number) => {
  if (typeof min === 'number' && value < min)
    return false

  if (typeof max === 'number' && value > max)
    return false

  return true
}

const resolveStep = (amount?: number, step?: InputNumberProps['step']) => (
  amount ?? (step === 'any' || typeof step === 'number' ? step : undefined) ?? 1
)

const exceedsStepBounds = ({
  value,
  reason,
  stepAmount,
  min,
  max,
}: {
  value?: number
  reason: BaseNumberFieldRoot.ChangeEventDetails['reason']
  stepAmount: number
  min?: number
  max?: number
}) => {
  if (typeof value !== 'number')
    return false

  if (reason === 'increment-press' && typeof max === 'number')
    return value + stepAmount > max

  if (reason === 'decrement-press' && typeof min === 'number')
    return value - stepAmount < min

  return false
}

export const InputNumber: FC<InputNumberProps> = (props) => {
  const {
    unit,
    className,
    wrapperClassName,
    styleCss,
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

  const resolvedStep = resolveStep(amount, step)
  const stepAmount = typeof resolvedStep === 'number' ? resolvedStep : 1

  const handleValueChange = useCallback((
    nextValue: number | null,
    eventDetails: BaseNumberFieldRoot.ChangeEventDetails,
  ) => {
    if (value === undefined && STEPPER_REASONS.has(eventDetails.reason)) {
      onChange(defaultValue ?? 0)
      return
    }

    if (nextValue === null) {
      onChange(0)
      return
    }

    if (exceedsStepBounds({
      value,
      reason: eventDetails.reason,
      stepAmount,
      min,
      max,
    })) {
      return
    }

    if (!isValueWithinBounds(nextValue, min, max))
      return

    onChange(nextValue)
  }, [defaultValue, max, min, onChange, stepAmount, value])

  return (
    <div data-testid="input-number-wrapper" className={cn('flex w-full min-w-0', wrapClassName, wrapperClassName)}>
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
            style={styleCss}
            className={className}
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
