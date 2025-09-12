import {
  memo,
  useCallback,
  useImperativeHandle,
  useMemo,
} from 'react'
import type {
  AnyFieldApi,
  AnyFormApi,
} from '@tanstack/react-form'
import {
  useForm,
  useStore,
} from '@tanstack/react-form'
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
  onChange?: (field: string, value: any) => void
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
  onChange,
}: BaseFormProps) => {
  const initialDefaultValues = useMemo(() => {
    if (defaultValues)
      return defaultValues

    return formSchemas.reduce((acc, schema) => {
      if (schema.default)
        acc[schema.name] = schema.default
      return acc
    }, {} as Record<string, any>)
  }, [defaultValues])
  const formFromHook = useForm({
    defaultValues: initialDefaultValues,
  })
  const form: any = formFromProps || formFromHook
  const { getFormValues } = useGetFormValues(form, formSchemas)
  const { getValidators } = useGetValidators()

  const showOnValues = useStore(form.store, (s: any) => {
    const result: Record<string, any> = {}
    formSchemas.forEach((schema) => {
      const { show_on } = schema
      if (show_on?.length) {
        show_on.forEach((condition) => {
          result[condition.variable] = s.values[condition.variable]
        })
      }
    })
    return result
  })

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
          onChange={onChange}
        />
      )
    }

    return null
  }, [formSchemas, fieldClassName, labelClassName, inputContainerClassName, inputClassName, disabled, onChange])

  const renderFieldWrapper = useCallback((formSchema: FormSchema) => {
    const validators = getValidators(formSchema)
    const {
      name,
      show_on = [],
    } = formSchema

    const show = show_on?.every((condition) => {
      const conditionValue = showOnValues[condition.variable]
      return conditionValue === condition.value
    })

    if (!show)
      return null

    return (
      <form.Field
        key={name}
        name={name}
        validators={validators}
      >
        {renderField}
      </form.Field>
    )
  }, [renderField, form, getValidators, showOnValues])

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
