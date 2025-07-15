import { useCallback } from 'react'
import type { AnyFormApi } from '@tanstack/react-form'
import { useToastContext } from '@/app/components/base/toast'
import type { FormSchema } from '@/app/components/base/form/types'

export const useCheckValidated = (form: AnyFormApi, FormSchemas: FormSchema[]) => {
  const { notify } = useToastContext()

  const checkValidated = useCallback(() => {
    const allError = form?.getAllErrors()
    const values = form.state.values

    if (allError) {
      const fields = allError.fields
      const errorArray = Object.keys(fields).reduce((acc: string[], key: string) => {
        const currentSchema = FormSchemas.find(schema => schema.name === key)
        const { show_on = [] } = currentSchema || {}
        const showOnValues = show_on.reduce((acc, condition) => {
          acc[condition.variable] = values[condition.variable]
          return acc
        }, {} as Record<string, any>)
        const show = show_on?.every((condition) => {
          const conditionValue = showOnValues[condition.variable]
          return conditionValue === condition.value
        })
        const errors: any[] = show ? fields[key].errors : []

        return [...acc, ...errors]
      }, [] as string[])

      if (errorArray.length) {
        notify({
          type: 'error',
          message: errorArray[0],
        })
        return false
      }

      return true
    }

    return true
  }, [form, notify, FormSchemas])

  return {
    checkValidated,
  }
}
