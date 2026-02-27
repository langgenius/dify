import type {
  AnyFieldApi,
  AnyFormApi,
} from '@tanstack/react-form'
import type {
  BaseFieldProps,
} from '.'
import type { FieldState, FormRef, FormSchema, SetFieldsParam } from '@/app/components/base/form/types'
import {
  useForm,
  useStore,
} from '@tanstack/react-form'
import {
  memo,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react'
import {
  useGetFormValues,
  useGetValidators,
} from '@/app/components/base/form/hooks'
import {

  FormItemValidateStatusEnum,

} from '@/app/components/base/form/types'
import { cn } from '@/utils/classnames'
import {
  BaseField,
} from '.'

export type BaseFormProps = {
  formSchemas?: FormSchema[]
  defaultValues?: Record<string, any>
  formClassName?: string
  ref?: FormRef
  disabled?: boolean
  formFromProps?: AnyFormApi
  onChange?: (field: string, value: any) => void
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void
  preventDefaultSubmit?: boolean
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
  onSubmit,
  preventDefaultSubmit = false,
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

  const [fieldStates, setFieldStates] = useState<Record<string, FieldState>>({})

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

  const setFields = useCallback((fields: SetFieldsParam[]) => {
    const newFieldStates: Record<string, FieldState> = { ...fieldStates }

    for (const field of fields) {
      const { name, value, errors, warnings, validateStatus, help } = field

      if (value !== undefined)
        form.setFieldValue(name, value)

      let finalValidateStatus = validateStatus
      if (!finalValidateStatus) {
        if (errors && errors.length > 0)
          finalValidateStatus = FormItemValidateStatusEnum.Error
        else if (warnings && warnings.length > 0)
          finalValidateStatus = FormItemValidateStatusEnum.Warning
      }

      newFieldStates[name] = {
        validateStatus: finalValidateStatus,
        help,
        errors,
        warnings,
      }
    }

    setFieldStates(newFieldStates)
  }, [form, fieldStates])

  useImperativeHandle(ref, () => {
    return {
      getForm() {
        return form
      },
      getFormValues: (option) => {
        return getFormValues(option)
      },
      setFields,
    }
  }, [form, getFormValues, setFields])

  const renderField = useCallback((field: AnyFieldApi) => {
    const formSchema = formSchemas?.find(schema => schema.name === field.name)

    if (formSchema) {
      return (
        <BaseField
          field={field}
          formSchema={formSchema}
          fieldClassName={fieldClassName ?? formSchema.fieldClassName}
          labelClassName={labelClassName ?? formSchema.labelClassName}
          inputContainerClassName={inputContainerClassName}
          inputClassName={inputClassName}
          disabled={disabled}
          onChange={onChange}
          fieldState={fieldStates[field.name]}
        />
      )
    }

    return null
  }, [formSchemas, fieldClassName, labelClassName, inputContainerClassName, inputClassName, disabled, onChange, fieldStates])

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

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (preventDefaultSubmit) {
      e.preventDefault()
      e.stopPropagation()
    }
    onSubmit?.(e)
  }

  return (
    <form
      className={cn(formClassName)}
      onSubmit={handleSubmit}
    >
      {formSchemas.map(renderFieldWrapper)}
    </form>
  )
}

export default memo(BaseForm)
