'use client'

import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import { useRequestErrorMessage } from '@/service/use-request-error-message'

/** A failed first load with a retry, shown where the loaded data would be. */
export function DatasetLoadErrorAlert({
  className,
  error,
  retrying = false,
  onRetry,
}: {
  className?: string
  error: unknown
  retrying?: boolean
  onRetry: () => void
}) {
  const { t } = useTranslation(['common', 'dataset'])
  const message = useRequestErrorMessage(
    error,
    t(($) => $.loadError, { ns: 'dataset' }),
  )
  if (!message) return null

  return (
    <Alert type="error" className={className}>
      <AlertTitle>{message}</AlertTitle>
      <AlertActions>
        <Button size="small" loading={retrying} onClick={onRetry}>
          {t(($) => $['operation.retry'], { ns: 'common' })}
        </Button>
      </AlertActions>
    </Alert>
  )
}
