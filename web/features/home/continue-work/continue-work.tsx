'use client'

import type { RecentAppResponse } from '@dify/contracts/api/console/apps/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { ContinueWorkItem } from './item'

type ContinueWorkProps = {
  apps: RecentAppResponse[]
  className?: string
}

export function ContinueWork({ apps, className }: ContinueWorkProps) {
  const { t } = useTranslation()

  if (apps.length === 0) return null

  return (
    <section className={cn('px-8 pb-5', className)} aria-labelledby="continue-work-title">
      <div className="flex items-center justify-between pt-2">
        <h2
          id="continue-work-title"
          className="min-w-0 truncate system-xl-medium text-text-primary"
        >
          {t(($) => $['continueWork.title'], { ns: 'explore' })}
        </h2>
        <Link
          href="/apps"
          className="-my-1 -mr-1 ml-3 flex min-h-6 shrink-0 touch-manipulation items-center gap-1 rounded-md p-1 system-xs-medium text-text-tertiary outline-hidden transition-colors hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid motion-reduce:transition-none"
        >
          {t(($) => $['continueWork.exploreStudio'], { ns: 'explore' })}
          <span className="i-ri-arrow-right-line size-3 shrink-0" aria-hidden="true" />
        </Link>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(296px,1fr))] gap-2.5 pt-2">
        {apps.map((app) => (
          <ContinueWorkItem key={app.id} app={app} />
        ))}
      </div>
    </section>
  )
}
