import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { FormSchema } from '../types'

export const useGetValidators = () => {
  const { t } = useTranslation()
  const getValidators = useCallback((formSchema: FormSchema) => {
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
    return mergedValidators
  }, [t])

  return {
    getValidators,
  }
}
