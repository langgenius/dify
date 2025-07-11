import {
  isValidElement,
  memo,
  useMemo,
} from 'react'
import type { AnyFieldApi } from '@tanstack/react-form'
import { useStore } from '@tanstack/react-form'
import cn from '@/utils/classnames'
import Input from '@/app/components/base/input'
import PureSelect from '@/app/components/base/select/pure'
import type { FormSchema } from '@/app/components/base/form/types'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { useRenderI18nObject } from '@/hooks/use-i18n'

export type BaseFieldProps = {
  fieldClassName?: string
  labelClassName?: string
  inputContainerClassName?: string
  inputClassName?: string
  formSchema: FormSchema
  field: AnyFieldApi
  disabled?: boolean
}
const BaseField = ({
  fieldClassName,
  labelClassName,
  inputContainerClassName,
  inputClassName,
  formSchema,
  field,
  disabled,
}: BaseFieldProps) => {
  const renderI18nObject = useRenderI18nObject()
  const {
    label,
    required,
    placeholder,
    options,
  } = formSchema

  const memorizedLabel = useMemo(() => {
    if (isValidElement(label))
      return label

    if (typeof label === 'string')
      return label

    if (typeof label === 'object' && label !== null)
      return renderI18nObject(label as Record<string, string>)
  }, [label, renderI18nObject])
  const memorizedPlaceholder = useMemo(() => {
    if (typeof placeholder === 'string')
      return placeholder

    if (typeof placeholder === 'object' && placeholder !== null)
      return renderI18nObject(placeholder as Record<string, string>)
  }, [placeholder, renderI18nObject])
  const memorizedOptions = useMemo(() => {
    return options?.map((option) => {
      return {
        label: typeof option.label === 'string' ? option.label : renderI18nObject(option.label),
        value: option.value,
      }
    }) || []
  }, [options, renderI18nObject])
  const value = useStore(field.form.store, s => s.values[field.name])

  return (
    <div className={cn(fieldClassName)}>
      <div className={cn(labelClassName)}>
        {memorizedLabel}
        {
          required && (
            <span className='ml-1 text-text-destructive-secondary'>*</span>
          )
        }
      </div>
      <div className={cn(inputContainerClassName)}>
        {
          formSchema.type === FormTypeEnum.textInput && (
            <Input
              id={field.name}
              name={field.name}
              className={cn(inputClassName)}
              value={value}
              onChange={e => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              disabled={disabled}
              placeholder={memorizedPlaceholder}
            />
          )
        }
        {
          formSchema.type === FormTypeEnum.secretInput && (
            <Input
              id={field.name}
              name={field.name}
              type='password'
              className={cn(inputClassName)}
              value={value}
              onChange={e => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              disabled={disabled}
              placeholder={memorizedPlaceholder}
            />
          )
        }
        {
          formSchema.type === FormTypeEnum.textNumber && (
            <Input
              id={field.name}
              name={field.name}
              type='number'
              className={cn(inputClassName)}
              value={value}
              onChange={e => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              disabled={disabled}
              placeholder={memorizedPlaceholder}
            />
          )
        }
        {
          formSchema.type === FormTypeEnum.select && (
            <PureSelect
              value={value}
              onChange={v => field.handleChange(v)}
              disabled={disabled}
              placeholder={memorizedPlaceholder}
              options={memorizedOptions}
              triggerPopupSameWidth
            />
          )
        }
      </div>
    </div>
  )
}

export default memo(BaseField)
