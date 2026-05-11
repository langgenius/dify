import type { LabelProps } from '../label'
import type { InputNumberWithSliderProps } from '@/app/components/workflow/nodes/_base/components/input-number-with-slider'
import { cn } from '@langgenius/dify-ui/cn'
import InputNumberWithSlider from '@/app/components/workflow/nodes/_base/components/input-number-with-slider'
import { useFieldContext } from '../..'
import Label from '../label'

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
          <div className="pb-0.5 body-xs-regular text-text-tertiary">
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
