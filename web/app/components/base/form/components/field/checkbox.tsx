import cn from '@/utils/classnames'
import { useFieldContext } from '../..'
import Checkbox from '../../../checkbox'

type CheckboxFieldProps = {
  label: string;
  labelClassName?: string;
}

const CheckboxField = ({
  label,
  labelClassName,
}: CheckboxFieldProps) => {
  const field = useFieldContext<boolean>()

  return (
    <div className='flex gap-2'>
      <div className='flex h-6 shrink-0 items-center'>
        <Checkbox
          id={field.name}
          checked={field.state.value}
          onCheck={() => {
            field.handleChange(!field.state.value)
          }}
        />
      </div>
      <label
        htmlFor={field.name}
        className={cn(
          'system-sm-medium grow cursor-pointer pt-1 text-text-secondary',
          labelClassName,
        )}
        onClick={() => {
          field.handleChange(!field.state.value)
        }}
      >
        {label}
      </label>
    </div>
  )
}

export default CheckboxField
