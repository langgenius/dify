'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'

export type ConnectionLoadStateProps = {
  loading?: boolean
  error?: boolean
  onRetry?: () => void
  onLoadMore?: () => void
  loadingMore?: boolean
}

export default function ConnectionLoadState({
  loading,
  error,
  onRetry,
  onLoadMore,
  loadingMore,
}: ConnectionLoadStateProps) {
  const { t } = useTranslation(['common'])
  return (
    <div className="space-y-2">
      {loading && (
        <p role="status" className="system-sm-regular text-text-tertiary">
          {t(($) => $.loading, { ns: 'common' })}
        </p>
      )}
      {error && (
        <p role="alert" className="system-sm-regular text-text-destructive">
          {t(($) => $['api.actionFailed'], { ns: 'common' })}
        </p>
      )}
      {onRetry && (
        <Button onClick={onRetry}>{t(($) => $['operation.retry'], { ns: 'common' })}</Button>
      )}
      {onLoadMore && (
        <Button onClick={onLoadMore} loading={loadingMore}>
          {t(($) => $['operation.more'], { ns: 'common' })}
        </Button>
      )}
    </div>
  )
}
