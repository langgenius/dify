import cn from '@/utils/classnames'
import { useFieldContext } from '../..'
import type { LabelProps } from '../label'
import Label from '../label'
import type { Options } from '@/app/components/app/configuration/config-var/config-select'
import ConfigSelect from '@/app/components/app/configuration/config-var/config-select'

type OptionsFieldProps = {
  label: string;
  labelOptions?: Omit<LabelProps, 'htmlFor' | 'label'>
  className?: string;
}

const OptionsField = ({
  label,
  className,
  labelOptions,
}: OptionsFieldProps) => {
  const field = useFieldContext<Options>()

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label
        htmlFor={field.name}
        label={label}
        {...(labelOptions ?? {})}
      />
      <ConfigSelect
        options={field.state.value}
        onChange={value => field.handleChange(value)}
      />
    </div>
  )
}

export default OptionsField
