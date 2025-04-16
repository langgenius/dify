import cn from '@/utils/classnames'
import { useFieldContext } from '..'
import PureSelect from '../../select/pure'
import Label from './label'

type SelectOption = {
  value: string
  label: string
}

type SelectFieldProps = {
  label: string
  options: SelectOption[]
  className?: string
  labelClassName?: string
}

const SelectField = ({
  label,
  options,
  className,
  labelClassName,
}: SelectFieldProps) => {
  const field = useFieldContext<string>()

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label
        htmlFor={field.name}
        className={labelClassName}
        label={label}
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
