'use client'

import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { continueWorkItems } from './data'
import ContinueWorkItem from './item'

type ContinueWorkProps = {
  className?: string
}

const ContinueWork = ({
  className,
}: ContinueWorkProps) => {
  const { t } = useTranslation()

  return (
    <section className={cn('px-12 pb-6', className)} aria-labelledby="continue-work-title">
      <div className="flex items-center justify-between">
        <h2 id="continue-work-title" className="min-w-0 truncate system-xl-semibold text-text-primary">
          {t('continueWork.title', { ns: 'explore' })}
        </h2>
        <Link
          href="/apps"
          className="ml-4 shrink-0 system-sm-medium text-text-accent"
        >
          {t('continueWork.exploreStudio', { ns: 'explore' })}
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2 xl:grid-cols-4">
        {continueWorkItems.map(item => (
          <ContinueWorkItem key={item.id} item={item} />
        ))}
      </div>
    </section>
  )
}

export default React.memo(ContinueWork)
