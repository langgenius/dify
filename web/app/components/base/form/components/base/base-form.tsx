import {
  memo,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AnyFieldApi,
  AnyFormApi,
} from '@tanstack/react-form'
import {
  useForm,
  useStore,
} from '@tanstack/react-form'
import {
  type FieldState,
  FormItemValidateStatusEnum,
  type FormRef,
  type FormSchema,
  type SetFieldsParam,
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
import { Button } from '@/app/components/base/button'

export type BaseFormProps = {
  formSchemas?: FormSchema[]
  defaultValues?: Record<string, any>
  formClassName?: string
  ref?: FormRef
  disabled?: boolean
  formFromProps?: AnyFormApi
  onCancel?: () => void
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
  onCancel,
  onChange,
  onSubmit,
  preventDefaultSubmit = false,
}: BaseFormProps) => {
  const { t } = useTranslation()
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
      const showOn = typeof show_on === 'function' ? show_on(form) : show_on
      if (showOn?.length) {
        showOn?.forEach((condition) => {
          result[condition.variable] = s.values[condition.variable]
        })
      }
    })
    return result
  })
  const moreOnValues = useStore(form.store, (s: any) => {
    const result: Record<string, any> = {}
    formSchemas.forEach((schema) => {
      const { more_on } = schema
      const moreOn = typeof more_on === 'function' ? more_on(form) : more_on
      if (moreOn?.length) {
        moreOn?.forEach((condition) => {
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
      const { more_on = [] } = formSchema
      const moreOn = typeof more_on === 'function' ? more_on(form) : more_on
      const more = (moreOn || []).every((condition) => {
        const conditionValue = moreOnValues[condition.variable]
        return Array.isArray(condition.value) ? condition.value.includes(conditionValue) : conditionValue === condition.value
      })

      return (
        <BaseField
          field={field}
          formSchema={formSchema}
          fieldClassName={cn(fieldClassName ?? formSchema.fieldClassName, !more ? 'absolute top-[-9999px]' : '')}
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
  }, [formSchemas, fieldClassName, labelClassName, inputContainerClassName, inputClassName, disabled, onChange, moreOnValues, fieldStates])

  const renderFieldWrapper = useCallback((formSchema: FormSchema) => {
    const validators = getValidators(formSchema)
    const {
      name,
      show_on = [],
    } = formSchema
    const showOn = typeof show_on === 'function' ? show_on(form) : show_on
    const show = (showOn || []).every((condition) => {
      const conditionValue = showOnValues[condition.variable]
      return Array.isArray(condition.value) ? condition.value.includes(conditionValue) : conditionValue === condition.value
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
      {
        onSubmit && (
          <div className='flex justify-end space-x-2'>
            {
              onCancel && (
                <Button
                  variant='secondary'
                  onClick={onCancel}
                >
                  {t('common.operation.cancel')}
                </Button>
              )
            }
            <Button
              variant='primary'
              onClick={() => onSubmit(form.getValues())}
            >
              {t('common.operation.save')}
            </Button>
          </div>
        )
      }
    </form>
  )
}

export default memo(BaseForm)
