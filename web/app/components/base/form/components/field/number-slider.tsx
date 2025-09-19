import cn from '@/utils/classnames'
import type { LabelProps } from '../label'
import { useFieldContext } from '../..'
import Label from '../label'
import type { InputNumberWithSliderProps } from '@/app/components/workflow/nodes/_base/components/input-number-with-slider'
import InputNumberWithSlider from '@/app/components/workflow/nodes/_base/components/input-number-with-slider'

type NumberSliderFieldProps = {
  label: string
  labelOptions?: Omit<LabelProps, 'htmlFor' | 'label'>
  description?: string
  className?: string
} & Omit<InputNumberWithSliderProps, 'value' | 'onChange'>

const NumberSliderField = ({
  label,
  labelOptions,
  description,
  className,
  ...InputNumberWithSliderProps
}: NumberSliderFieldProps) => {
  const field = useFieldContext<number>()

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <div>
        <Label
          htmlFor={field.name}
          label={label}
          {...(labelOptions ?? {})}
        />
        {description && (
          <div className='body-xs-regular pb-0.5 text-text-tertiary'>
            {description}
          </div>
        )}
      </div>
      <InputNumberWithSlider
        value={field.state.value}
        onChange={value => field.handleChange(value)}
        {...InputNumberWithSliderProps}
      />
    </div>
  )
}

export default NumberSliderField
