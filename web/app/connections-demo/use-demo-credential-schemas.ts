import type { FormSchema } from '@/app/components/base/form/types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { FormTypeEnum } from '@/app/components/base/form/types'

export function useDemoCredentialSchemas() {
  const { t } = useTranslation(['share', 'common'])
  return useMemo<FormSchema[]>(() => {
    const validateKey = ({ value }: { value: unknown }) => {
      const key = typeof value === 'string' ? value.trim() : ''
      if (!key)
        return t(($) => $['errorMsg.fieldRequired'], {
          ns: 'common',
          field: t(($) => $['connections.setup.apiKey'], { ns: 'share' }),
        })
      return key.startsWith('sk')
        ? undefined
        : t(($) => $['connections.apiKeys.validationError'], { ns: 'share' })
    }
    return [
      {
        name: 'api_key',
        type: FormTypeEnum.secretInput,
        label: t(($) => $['connections.setup.apiKey'], { ns: 'share' }),
        placeholder: t(($) => $['connections.apiKeys.newKeyPlaceholder'], { ns: 'share' }),
        required: true,
        validators: { onMount: validateKey, onChange: validateKey, onBlur: validateKey },
      },
    ]
  }, [t])
}
