import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { useFieldContext } from '../..'

type CheckboxFieldProps = {
  label: string
  labelClassName?: string
}

const CheckboxField = ({
  label,
  labelClassName,
}: CheckboxFieldProps) => {
  const field = useFieldContext<boolean>()

  return (
    <label className="flex cursor-pointer gap-2">
      <span className="flex h-6 shrink-0 items-center">
        <Checkbox
          checked={field.state.value}
          onCheckedChange={checked => field.handleChange(checked)}
        />
      </span>
      <span
        className={cn(
          'grow pt-1 system-sm-medium text-text-secondary',
          labelClassName,
        )}
      >
        {label}
      </span>
    </label>
  )
}

export default CheckboxField
