import {
  memo,
  useCallback,
  useImperativeHandle,
} from 'react'
import type {
  AnyFieldApi,
} from '@tanstack/react-form'
import { useTranslation } from 'react-i18next'
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
import { useGetFormValues } from '@/app/components/base/form/hooks'

export type BaseFormProps = {
  formSchemas?: FormSchema[]
  defaultValues?: Record<string, any>
  formClassName?: string
  ref?: FormRef
  disabled?: boolean
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
}: BaseFormProps) => {
  const { t } = useTranslation()
  const form = useForm({
    defaultValues,
  })
  const { getFormValues } = useGetFormValues(form)

  useImperativeHandle(ref, () => {
    return {
      getForm() {
        return form
      },
      getFormValues: (option) => {
        return getFormValues(formSchemas, option)
      },
    }
  }, [form, formSchemas, getFormValues])

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
    const {
      name,
      validators,
      required,
    } = formSchema
    let mergedValidators = validators
    if (required && !validators) {
      mergedValidators = {
        onMount: ({ value }: any) => {
          if (!value)
            return t('common.errorMsg.fieldRequired', { field: name })
        },
        onChange: ({ value }: any) => {
          if (!value)
            return t('common.errorMsg.fieldRequired', { field: name })
        },
        onBlur: ({ value }: any) => {
          if (!value)
            return t('common.errorMsg.fieldRequired', { field: name })
        },
      }
    }

    return (
      <form.Field
        key={name}
        name={name}
        validators={mergedValidators}
      >
        {renderField}
      </form.Field>
    )
  }, [renderField, form, t])

  if (!formSchemas?.length)
    return null

  return (
    <form
      className={cn(formClassName)}
      onSubmit={(e) => {
        e.preventDefault()
        form?.handleSubmit()
      }}
    >
      {formSchemas.map(renderFieldWrapper)}
    </form>
  )
}

export default memo(BaseForm)
