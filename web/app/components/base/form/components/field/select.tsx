import cn from '@/utils/classnames'
import { useFieldContext } from '../..'
import type { PureSelectProps } from '../../../select/pure'
import PureSelect from '../../../select/pure'
import Label from '../label'
import { useCallback } from 'react'

type SelectOption = {
  value: string
  label: string
}

type SelectFieldProps = {
  label: string
  options: SelectOption[]
  onChange?: (value: string) => void
  isRequired?: boolean
  showOptional?: boolean
  tooltip?: string
  className?: string
  labelClassName?: string
} & Omit<PureSelectProps, 'options' | 'value' | 'onChange'>

const SelectField = ({
  label,
  options,
  onChange,
  isRequired,
  showOptional,
  tooltip,
  className,
  labelClassName,
  ...selectProps
}: SelectFieldProps) => {
  const field = useFieldContext<string>()

  const handleChange = useCallback((value: string) => {
    field.handleChange(value)
    onChange?.(value)
  }, [field, onChange])

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label
        htmlFor={field.name}
        label={label}
        isRequired={isRequired}
        showOptional={showOptional}
        tooltip={tooltip}
        className={labelClassName}
      />
      <PureSelect
        value={field.state.value}
        options={options}
        onChange={handleChange}
        {...selectProps}
      />
    </div>
  )
}

export default SelectField
