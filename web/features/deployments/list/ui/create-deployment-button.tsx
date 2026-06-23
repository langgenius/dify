'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'

export function CreateDeploymentButton({ className }: {
  className?: string
}) {
  const { t } = useTranslation('deployments')

  return (
    <Link
      href="/deployments/create"
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary-600 px-3 system-sm-medium whitespace-nowrap text-text-primary-on-surface hover:bg-primary-700',
        className,
      )}
    >
      <span className="i-ri-add-line size-4 shrink-0" aria-hidden="true" />
      <span>{t('list.createDeployment')}</span>
    </Link>
  )
}
