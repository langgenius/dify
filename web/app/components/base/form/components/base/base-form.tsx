import {
  memo,
  useCallback,
  useImperativeHandle,
} from 'react'
import type {
  AnyFieldApi,
  AnyFormApi,
} from '@tanstack/react-form'
import { useForm } from '@tanstack/react-form'
import type {
  FormRef,
  FormSchema,
} from '@/app/components/base/form/types'
import {
  BaseField,
} from '.'
import type {
  BaseFieldProps,
} from '.'
import cn from '@/utils/classnames'
import {
  useGetFormValues,
  useGetValidators,
} from '@/app/components/base/form/hooks'

export type BaseFormProps = {
  formSchemas?: FormSchema[]
  defaultValues?: Record<string, any>
  formClassName?: string
  ref?: FormRef
  disabled?: boolean
  formFromProps?: AnyFormApi
} & Pick<BaseFieldProps, 'fieldClassName' | 'labelClassName' | 'inputContainerClassName' | 'inputClassName'>

const BaseForm = ({
  formSchemas = [],
  defaultValues,
  formClassName,
  fieldClassName,
  labelClassName,
  inputContainerClassName,
  inputClassName,
  ref,
  disabled,
  formFromProps,
}: BaseFormProps) => {
  const formFromHook = useForm({
    defaultValues,
  })
  const form: any = formFromProps || formFromHook
  const { getFormValues } = useGetFormValues(form, formSchemas)
  const { getValidators } = useGetValidators()

  useImperativeHandle(ref, () => {
    return {
      getForm() {
        return form
      },
      getFormValues: (option) => {
        return getFormValues(option)
      },
    }
  }, [form, getFormValues])

  const renderField = useCallback((field: AnyFieldApi) => {
    const formSchema = formSchemas?.find(schema => schema.name === field.name)

    if (formSchema) {
      return (
        <BaseField
          field={field}
          formSchema={formSchema}
          fieldClassName={fieldClassName}
          labelClassName={labelClassName}
          inputContainerClassName={inputContainerClassName}
          inputClassName={inputClassName}
          disabled={disabled}
        />
      )
    }

    return null
  }, [formSchemas, fieldClassName, labelClassName, inputContainerClassName, inputClassName, disabled])

  const renderFieldWrapper = useCallback((formSchema: FormSchema) => {
    const validators = getValidators(formSchema)
    const {
      name,
    } = formSchema

    return (
      <form.Field
        key={name}
        name={name}
        validators={validators}
      >
        {renderField}
      </form.Field>
    )
  }, [renderField, form, getValidators])

  if (!formSchemas?.length)
    return null

  return (
    <form
      className={cn(formClassName)}
    >
      {formSchemas.map(renderFieldWrapper)}
    </form>
  )
}

export default memo(BaseForm)
