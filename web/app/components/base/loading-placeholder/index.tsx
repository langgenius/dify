'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { Spinner } from '@langgenius/dify-ui/spinner'
import { useTranslation } from 'react-i18next'

type LoadingPlaceholderProps = {
  label?: string
  className?: string
}

function LoadingPlaceholder({ label, className }: LoadingPlaceholderProps) {
  const { t } = useTranslation()

  return (
    <div className={cn('flex w-full items-center justify-center', className)}>
      <Spinner aria-label={label ?? t(($) => $.loading, { ns: 'common' })} />
    </div>
  )
}

export { LoadingPlaceholder }
