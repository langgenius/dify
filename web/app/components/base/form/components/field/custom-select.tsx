import cn from '@/utils/classnames'
import { useFieldContext } from '../..'
import type { CustomSelectProps, Option } from '../../../select/custom'
import CustomSelect from '../../../select/custom'
import Label from '../label'
import { useCallback } from 'react'

type CustomSelectFieldProps<T extends Option> = {
  label: string
  options: T[]
  onChange?: (value: string) => void
  isRequired?: boolean
  showOptional?: boolean
  tooltip?: string
  className?: string
  labelClassName?: string
} & Omit<CustomSelectProps<T>, 'options' | 'value' | 'onChange'>

const CustomSelectField = <T extends Option>({
  label,
  options,
  onChange,
  isRequired,
  showOptional,
  tooltip,
  className,
  labelClassName,
  ...selectProps
}: CustomSelectFieldProps<T>) => {
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
      <CustomSelect<T>
        value={field.state.value}
        options={options}
        onChange={handleChange}
        {...selectProps}
      />
    </div>
  )
}

export default CustomSelectField
