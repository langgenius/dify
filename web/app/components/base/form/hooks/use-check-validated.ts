import { useCallback } from 'react'
import type { AnyFormApi } from '@tanstack/react-form'
import { useToastContext } from '@/app/components/base/toast'

export const useCheckValidated = (form: AnyFormApi) => {
  const { notify } = useToastContext()

  const checkValidated = useCallback(() => {
    const allError = form?.getAllErrors()
    console.log('allError', allError)

    if (allError) {
      const fields = allError.fields
      const errorArray = Object.keys(fields).reduce((acc: string[], key: string) => {
        const errors: any[] = fields[key].errors

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
  }, [form, notify])

  return {
    checkValidated,
  }
}
