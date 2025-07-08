import {
  isValidElement,
  memo,
  useMemo,
} from 'react'
import type { AnyFieldApi } from '@tanstack/react-form'
import cn from '@/utils/classnames'
import Input from '@/app/components/base/input'
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
}
const BaseField = ({
  fieldClassName,
  labelClassName,
  inputContainerClassName,
  inputClassName,
  formSchema,
  field,
}: BaseFieldProps) => {
  const renderI18nObject = useRenderI18nObject()
  const {
    label,
  } = formSchema

  const memorizedLabel = useMemo(() => {
    if (isValidElement(label))
      return label

    if (typeof label === 'object' && label !== null)
      return renderI18nObject(label as Record<string, string>)
  }, [label, renderI18nObject])

  return (
    <div className={cn(fieldClassName)}>
      <div className={cn(labelClassName)}>
        {memorizedLabel}
      </div>
      <div className={cn(inputContainerClassName)}>
        {
          formSchema.type === FormTypeEnum.textInput && (
            <Input
              className={cn(inputClassName)}
              id={field.name}
              value={field.state.value}
              onChange={e => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
            />
          )
        }
        {
          formSchema.type === FormTypeEnum.secretInput && (
            <Input
              type='password'
              className={cn(inputClassName)}
              id={field.name}
              value={field.state.value}
              onChange={e => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
            />
          )
        }
      </div>
    </div>
  )
}

export default memo(BaseField)
