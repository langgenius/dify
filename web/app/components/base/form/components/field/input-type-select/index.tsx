import type { LabelProps } from '../../label'
import type { FileTypeSelectOption, InputType } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useFieldContext } from '../../..'
import Label from '../../label'
import { useInputTypeOptions } from './hooks'
import Option from './option'
import Trigger from './trigger'

type InputTypeSelectFieldProps = {
  label: string
  labelOptions?: Omit<LabelProps, 'htmlFor' | 'label'>
  supportFile: boolean
  className?: string
  disabled?: boolean
}

const InputTypeSelectField = ({
  label,
  labelOptions,
  supportFile,
  className,
  disabled,
}: InputTypeSelectFieldProps) => {
  const field = useFieldContext<InputType>()
  const inputTypeOptions = useInputTypeOptions(supportFile)
  const selected = inputTypeOptions.find(option => option.value === field.state.value)

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label
        htmlFor={field.name}
        label={label}
        {...(labelOptions ?? {})}
      />
      <Select
        items={inputTypeOptions}
        value={field.state.value ?? null}
        disabled={disabled}
        onValueChange={(next) => {
          if (next == null)
            return
          field.handleChange(next as InputType)
        }}
      >
        <SelectTrigger id={field.name} className="gap-x-0.5 px-2">
          <Trigger option={selected} />
        </SelectTrigger>
        <SelectContent popupClassName="w-[368px] bg-components-panel-bg-blur shadow-shadow-shadow-5">
          {inputTypeOptions.map((option: FileTypeSelectOption) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="gap-x-1"
            >
              <Option option={option} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export default InputTypeSelectField
