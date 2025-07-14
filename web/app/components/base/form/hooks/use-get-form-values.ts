import { useCallback } from 'react'
import type { AnyFormApi } from '@tanstack/react-form'
import { useCheckValidated } from './use-check-validated'
import type {
  FormSchema,
  GetValuesOptions,
} from '../types'
import { getTransformedValuesWhenSecretInputPristine } from '../utils'

export const useGetFormValues = (form: AnyFormApi) => {
  const { checkValidated } = useCheckValidated(form)

  const getFormValues = useCallback((
    formSchemas: FormSchema[],
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
  }, [form, checkValidated])

  return {
    getFormValues,
  }
}
