import type { AnyFormApi } from '@tanstack/react-form'
import type { FormSchema } from '@/app/components/base/form/types'
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback } from 'react'

export const useCheckValidated = (
  form: AnyFormApi,
  FormSchemas: FormSchema[],
  onInvalidField?: (name: string) => void,
) => {
  const checkValidated = useCallback(() => {
    const allError = form?.getAllErrors()
    const values = form.state.values
    if (allError) {
      const fields = allError.fields
      let firstInvalidField: string | undefined
      const fieldNames = [
        ...new Set([...FormSchemas.map((schema) => schema.name), ...Object.keys(fields)]),
      ]
      const errorArray = fieldNames.reduce((acc: string[], key: string) => {
        const currentSchema = FormSchemas.find((schema) => schema.name === key)
        const { show_on = [] } = currentSchema || {}
        const showOnValues = show_on.reduce(
          (acc, condition) => {
            acc[condition.variable] = values[condition.variable]
            return acc
          },
          {} as Record<string, any>,
        )
        const show = show_on?.every((condition) => {
          const conditionValue = showOnValues[condition.variable]
          return conditionValue === condition.value
        })
        const errors: any[] = show ? (fields[key]?.errors ?? []) : []
        if (errors.length && firstInvalidField === undefined) firstInvalidField = key
        return [...acc, ...errors]
      }, [] as string[])
      if (errorArray.length) {
        toast.error(errorArray[0])
        if (firstInvalidField !== undefined) onInvalidField?.(firstInvalidField)
        return false
      }
      return true
    }
    return true
  }, [form, FormSchemas, onInvalidField])
  return {
    checkValidated,
  }
}
