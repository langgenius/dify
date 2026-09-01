'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'

export function DocumentErrorState({
  description,
  onRetry,
  title,
}: {
  description: string
  onRetry?: () => void
  title: string
}) {
  const { t: tCommon } = useTranslation('common')

  return (
    <div className="flex min-h-80 flex-col items-center justify-center px-6 text-center">
      <span aria-hidden className="i-ri-error-warning-line size-8 text-text-destructive" />
      <h1 className="mt-3 title-2xl-semi-bold text-text-primary">{title}</h1>
      <p className="mt-2 max-w-lg body-sm-regular text-text-tertiary">{description}</p>
      {onRetry && (
        <Button className="mt-4" onClick={onRetry}>
          {tCommon(($) => $['operation.retry'])}
        </Button>
      )}
    </div>
  )
}
