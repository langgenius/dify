import type { ReactNode } from 'react'
import type { NumberFieldInputProps, NumberFieldRootProps, NumberFieldSize } from '../../../ui/number-field'
import type { LabelProps } from '../label'
import * as React from 'react'
import { cn } from '@/utils/classnames'
import { useFieldContext } from '../..'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
  NumberFieldUnit,
} from '../../../ui/number-field'
import Label from '../label'

type NumberInputFieldProps = {
  label: string
  labelOptions?: Omit<LabelProps, 'htmlFor' | 'label'>
  className?: string
  inputClassName?: string
  unit?: ReactNode
  size?: NumberFieldSize
} & Omit<NumberFieldRootProps, 'children' | 'className' | 'id' | 'value' | 'defaultValue' | 'onValueChange'> & Omit<NumberFieldInputProps, 'children' | 'size' | 'onBlur' | 'className' | 'onChange'>

const NumberInputField = ({
  label,
  labelOptions,
  className,
  inputClassName,
  unit,
  size = 'regular',
  ...props
}: NumberInputFieldProps) => {
  const field = useFieldContext<number>()
  const {
    value: _value,
    min,
    max,
    step,
    disabled,
    readOnly,
    required,
    name: _name,
    id: _id,
    ...inputProps
  } = props
  const emptyValue = min ?? 0

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label
        htmlFor={field.name}
        label={label}
        {...(labelOptions ?? {})}
      />
      <NumberField
        id={field.name}
        name={field.name}
        value={field.state.value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        onValueChange={value => field.handleChange(value ?? emptyValue)}
      >
        <NumberFieldGroup size={size}>
          <NumberFieldInput
            {...inputProps}
            size={size}
            className={inputClassName}
            onBlur={field.handleBlur}
          />
          {Boolean(unit) && (
            <NumberFieldUnit size={size}>
              {unit}
            </NumberFieldUnit>
          )}
          <NumberFieldControls>
            <NumberFieldIncrement size={size} />
            <NumberFieldDecrement size={size} />
          </NumberFieldControls>
        </NumberFieldGroup>
      </NumberField>
    </div>
  )
}

export default NumberInputField
