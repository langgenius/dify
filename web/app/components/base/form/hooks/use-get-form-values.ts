import { useCallback } from 'react'
import type { AnyFormApi } from '@tanstack/react-form'
import { useCheckValidated } from './use-check-validated'
import type {
  FormSchema,
  GetValuesOptions,
} from '../types'
import { getTransformedValuesWhenSecretInputPristine } from '../utils'

export const useGetFormValues = (form: AnyFormApi, formSchemas: FormSchema[]) => {
  const { checkValidated } = useCheckValidated(form, formSchemas)

  const getFormValues = useCallback((
    {
      needCheckValidatedValues,
      needTransformWhenSecretFieldIsPristine,
    }: GetValuesOptions,
  ) => {
    const values = form?.store.state.values || {}
    if (!needCheckValidatedValues) {
      return {
        values,
        isCheckValidated: false,
      }
    }

    if (checkValidated()) {
      return {
        values: needTransformWhenSecretFieldIsPristine ? getTransformedValuesWhenSecretInputPristine(formSchemas, form) : values,
        isCheckValidated: true,
      }
    }
    else {
      return {
        values: {},
        isCheckValidated: false,
      }
    }
  }, [form, checkValidated, formSchemas])

  return {
    getFormValues,
  }
}
