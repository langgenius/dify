import cn from '@/utils/classnames'
import { useFieldContext } from '../..'
import PureSelect from '../../../select/pure'
import Label from '../label'

type SelectOption = {
  value: string
  label: string
}

type SelectFieldProps = {
  label: string
  options: SelectOption[]
  isRequired?: boolean
  showOptional?: boolean
  tooltip?: string
  className?: string
  labelClassName?: string
}

const SelectField = ({
  label,
  options,
  isRequired,
  showOptional,
  tooltip,
  className,
  labelClassName,
}: SelectFieldProps) => {
  const field = useFieldContext<string>()

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
        onChange={value => field.handleChange(value)}
      />
    </div>
  )
}

export default SelectField
