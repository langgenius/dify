import type { AnyFormApi } from '@tanstack/react-form'
import type {
  FormSchema,
  GetValuesOptions,
} from '../types'
import { useCallback } from 'react'
import { getTransformedValuesWhenSecretInputPristine } from '../utils/secret-input'
import { useCheckValidated } from './use-check-validated'

export const useGetFormValues = (form: AnyFormApi, formSchemas: FormSchema[]) => {
  const { checkValidated } = useCheckValidated(form, formSchemas)

  const getFormValues = useCallback((
    {
      needCheckValidatedValues = true,
      needTransformWhenSecretFieldIsPristine,
    }: GetValuesOptions,
  ) => {
    const values = form?.store.state.values || {}
    if (!needCheckValidatedValues) {
      return {
        values,
        isCheckValidated: true,
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
