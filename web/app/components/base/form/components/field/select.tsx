import cn from '@/utils/classnames'
import { useFieldContext } from '../..'
import type { Option, PureSelectProps } from '../../../select/pure'
import PureSelect from '../../../select/pure'
import type { LabelProps } from '../label'
import Label from '../label'

type SelectFieldProps = {
  label: string
  labelOptions?: Omit<LabelProps, 'htmlFor' | 'label'>
  options: Option[]
  onChange?: (value: string) => void
  className?: string
} & Omit<PureSelectProps, 'options' | 'value' | 'onChange'>

const SelectField = ({
  label,
  labelOptions,
  options,
  onChange,
  className,
  ...selectProps
}: SelectFieldProps) => {
  const field = useFieldContext<string>()

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label
        htmlFor={field.name}
        label={label}
        {...(labelOptions ?? {})}
      />
      <PureSelect
        value={field.state.value}
        options={options}
        onChange={(value) => {
          field.handleChange(value)
          onChange?.(value)
        }}
        {...selectProps}
      />
    </div>
  )
}

export default SelectField
