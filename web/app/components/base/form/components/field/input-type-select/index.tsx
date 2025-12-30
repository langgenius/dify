import type { CustomSelectProps } from '../../../../select/custom'
import type { LabelProps } from '../../label'
import type { FileTypeSelectOption, InputType } from './types'
import { useCallback } from 'react'
import { cn } from '@/utils/classnames'
import { useFieldContext } from '../../..'
import CustomSelect from '../../../../select/custom'
import Label from '../../label'
import { useInputTypeOptions } from './hooks'
import Option from './option'
import Trigger from './trigger'

type InputTypeSelectFieldProps = {
  label: string
  labelOptions?: Omit<LabelProps, 'htmlFor' | 'label'>
  supportFile: boolean
  className?: string
} & Omit<CustomSelectProps<FileTypeSelectOption>, 'options' | 'value' | 'onChange' | 'CustomTrigger' | 'CustomOption'>

const InputTypeSelectField = ({
  label,
  labelOptions,
  supportFile,
  className,
  ...customSelectProps
}: InputTypeSelectFieldProps) => {
  const field = useFieldContext<InputType>()
  const inputTypeOptions = useInputTypeOptions(supportFile)

  const renderTrigger = useCallback((option: FileTypeSelectOption | undefined, open: boolean) => {
    return <Trigger option={option} open={open} />
  }, [])
  const renderOption = useCallback((option: FileTypeSelectOption) => {
    return <Option option={option} />
  }, [])

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label
        htmlFor={field.name}
        label={label}
        {...(labelOptions ?? {})}
      />
      <CustomSelect<FileTypeSelectOption>
        value={field.state.value}
        options={inputTypeOptions}
        onChange={value => field.handleChange(value as InputType)}
        triggerProps={{
          className: 'gap-x-0.5',
        }}
        popupProps={{
          className: 'w-[368px]',
          wrapperClassName: 'z-[9999999]',
          itemClassName: 'gap-x-1',
        }}
        CustomTrigger={renderTrigger}
        CustomOption={renderOption}
        {...customSelectProps}
      />
    </div>
  )
}

export default InputTypeSelectField
