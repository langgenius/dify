'use client'

import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { StepShell } from './layout'

export function DoneStep({ environmentName }: {
  environmentName: string
}) {
  const { t } = useTranslation('deployments')

  return (
    <StepShell title={t('createGuide.done.title')} description={t('createGuide.done.description', { environment: environmentName })}>
      <div className="flex flex-col gap-4 rounded-lg bg-background-default-subtle p-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-util-colors-green-green-600 text-text-primary-on-surface">
            <span className="i-ri-check-line size-5" aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="system-md-semibold text-text-primary">{t('createGuide.done.ready')}</div>
            <div className="system-sm-regular text-text-tertiary">{t('createGuide.done.next')}</div>
          </div>
        </div>
        <div className="flex justify-end">
          <Link
            href="/deployments"
            className="inline-flex h-8 items-center rounded-lg bg-primary-600 px-3 system-sm-medium text-text-primary-on-surface hover:bg-primary-700"
          >
            {t('createGuide.done.backToList')}
          </Link>
        </div>
      </div>
    </StepShell>
  )
}
