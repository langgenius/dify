import cn from '@/utils/classnames'
import { useFieldContext } from '../..'
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
}

const SelectField = ({
  label,
  options,
  onChange,
  isRequired,
  showOptional,
  tooltip,
  className,
  labelClassName,
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
      />
    </div>
  )
}

export default SelectField
