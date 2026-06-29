'use client'

import type { App as WorkspaceApp } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from '#i18n'
import Link from '@/next/link'
import ContinueWorkItem from './item'

type ContinueWorkProps = {
  apps: WorkspaceApp[]
  className?: string
}

const ContinueWork = ({
  apps,
  className,
}: ContinueWorkProps) => {
  const { t } = useTranslation()

  if (apps.length === 0)
    return null

  return (
    <section className={cn('px-8 pb-5', className)} aria-labelledby="continue-work-title">
      <div className="flex items-center justify-between pt-2">
        <h2 id="continue-work-title" className="min-w-0 truncate system-xl-medium text-text-primary">
          {t('continueWork.title', { ns: 'explore' })}
        </h2>
        <Link
          href="/apps"
          className="ml-4 flex shrink-0 items-center gap-1 system-xs-medium text-text-tertiary"
        >
          {t('continueWork.exploreStudio', { ns: 'explore' })}
          <span className="i-ri-arrow-right-line size-3 shrink-0" aria-hidden="true" />
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-2.5 pt-2 sm:grid-cols-2 xl:grid-cols-4">
        {apps.map(app => (
          <ContinueWorkItem key={app.id} app={app} />
        ))}
      </div>
    </section>
  )
}

export default React.memo(ContinueWork)
