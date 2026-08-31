import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'

export function QualityQueryState({
  children,
  error,
  loading,
  onRetry,
}: {
  children: ReactNode
  error: boolean
  loading: boolean
  onRetry: () => void
}) {
  const { t } = useTranslation('dataset')

  if (loading)
    return (
      <div className="flex min-h-105 items-center justify-center">
        <Loading />
      </div>
    )

  if (error)
    return (
      <div className="flex min-h-105 flex-col items-center justify-center gap-3 text-center">
        <span aria-hidden className="i-ri-error-warning-line size-8 text-text-warning" />
        <p role="alert" className="system-sm-medium text-text-primary">
          {t(($) => $.unknownError)}
        </p>
        <Button onClick={onRetry}>{t(($) => $.retry)}</Button>
      </div>
    )

  return children
}
