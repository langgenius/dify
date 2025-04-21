import cn from '@/utils/classnames'
import { useFieldContext } from '../..'
import Label from '../label'
import ConfigSelect from '@/app/components/app/configuration/config-var/config-select'

type OptionsFieldProps = {
  label: string;
  className?: string;
  labelClassName?: string;
}

const OptionsField = ({
  label,
  className,
  labelClassName,
}: OptionsFieldProps) => {
  const field = useFieldContext<string[]>()

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label
        htmlFor={field.name}
        label={label}
        className={labelClassName}
      />
      <ConfigSelect
        options={field.state.value}
        onChange={value => field.handleChange(value)}
      />
    </div>
  )
}

export default OptionsField
