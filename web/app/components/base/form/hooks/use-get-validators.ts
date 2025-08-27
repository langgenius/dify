import {
  isValidElement,
  useCallback,
} from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { FormSchema } from '../types'
import { useRenderI18nObject } from '@/hooks/use-i18n'

export const useGetValidators = () => {
  const { t } = useTranslation()
  const renderI18nObject = useRenderI18nObject()
  const getLabel = useCallback((label: string | Record<string, string> | ReactNode) => {
    if (isValidElement(label))
      return ''

    if (typeof label === 'string')
      return label

    if (typeof label === 'object' && label !== null)
      return renderI18nObject(label as Record<string, string>)
  }, [])
  const getValidators = useCallback((formSchema: FormSchema) => {
    const {
      name,
      validators,
      required,
      label,
    } = formSchema
    let mergedValidators = validators
    const memorizedLabel = getLabel(label)
    if (required && !validators) {
      mergedValidators = {
        onMount: ({ value }: any) => {
          if (!value)
            return t('common.errorMsg.fieldRequired', { field: memorizedLabel || name })
        },
        onChange: ({ value }: any) => {
          if (!value)
            return t('common.errorMsg.fieldRequired', { field: memorizedLabel || name })
        },
        onBlur: ({ value }: any) => {
          if (!value)
            return t('common.errorMsg.fieldRequired', { field: memorizedLabel })
        },
      }
    }
    return mergedValidators
  }, [t, getLabel])

  return {
    getValidators,
  }
}
