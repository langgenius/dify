'use client'

import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'

type Props = {
  isRetrying: boolean
  onRetry: () => void
}

const VectorSpaceUnavailable = ({ isRetrying, onRetry }: Props) => {
  const { t } = useTranslation(['billing', 'common'])

  return (
    <Alert type="error">
      <AlertTitle>
        {t(($) => $['usagePage.vectorSpace'], { ns: 'billing' })}:{' '}
        {t(($) => $['plansCommon.unavailable'], { ns: 'billing' })}
      </AlertTitle>
      <AlertActions>
        <Button size="small" loading={isRetrying} onClick={onRetry}>
          {t(($) => $['operation.retry'], { ns: 'common' })}
        </Button>
      </AlertActions>
    </Alert>
  )
}

export default VectorSpaceUnavailable
