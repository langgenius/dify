'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'

type Props = {
  isRetrying: boolean
  onRetry: () => void
}

const VectorSpaceUnavailable = ({ isRetrying, onRetry }: Props) => {
  const { t } = useTranslation()

  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-xl border border-state-destructive-border bg-state-destructive-hover-alt p-3"
    >
      <span className="i-ri-error-warning-fill size-4 shrink-0 text-text-destructive" />
      <div className="grow system-sm-medium text-text-destructive">
        {t(($) => $['usagePage.vectorSpace'], { ns: 'billing' })}:{' '}
        {t(($) => $['plansCommon.unavailable'], { ns: 'billing' })}
      </div>
      <Button size="small" variant="secondary" loading={isRetrying} onClick={onRetry}>
        {t(($) => $['operation.retry'], { ns: 'common' })}
      </Button>
    </div>
  )
}

export default VectorSpaceUnavailable
