import type { CustomSelectProps, Option } from '../../../select/custom'
import type { LabelProps } from '../label'
import { cn } from '@/utils/classnames'
import { useFieldContext } from '../..'
import CustomSelect from '../../../select/custom'
import Label from '../label'

type CustomSelectFieldProps<T extends Option> = {
  label: string
  labelOptions?: Omit<LabelProps, 'htmlFor' | 'label'>
  options: T[]
  className?: string
} & Omit<CustomSelectProps<T>, 'options' | 'value' | 'onChange'>

const CustomSelectField = <T extends Option>({
  label,
  labelOptions,
  options,
  className,
  ...selectProps
}: CustomSelectFieldProps<T>) => {
  const field = useFieldContext<string>()

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label
        htmlFor={field.name}
        label={label}
        {...(labelOptions ?? {})}
      />
      <CustomSelect<T>
        value={field.state.value}
        options={options}
        onChange={value => field.handleChange(value)}
        {...selectProps}
      />
    </div>
  )
}

export default CustomSelectField
