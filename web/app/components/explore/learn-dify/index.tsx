'use client'

import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { learnDifyItems } from './data'
import LearnDifyItem from './item'

type LearnDifyProps = {
  className?: string
}

const LearnDify = ({
  className,
}: LearnDifyProps) => {
  const { t } = useTranslation()

  return (
    <section className={cn('px-12 pb-6', className)} aria-labelledby="learn-dify-title">
      <div className="flex min-h-12 items-end justify-between gap-4 pb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-4">
            <h2 id="learn-dify-title" className="min-w-0 truncate system-xl-semibold text-text-primary">
              {t('learnDify.title', { ns: 'explore' })}
            </h2>
            <button type="button" className="shrink-0 system-sm-medium text-text-primary">
              {t('learnDify.hide', { ns: 'explore' })}
            </button>
          </div>
          <div className="mt-1 flex items-center justify-between gap-4">
            <p className="min-w-0 truncate system-xs-regular text-text-tertiary">
              {t('learnDify.description', { ns: 'explore' })}
            </p>
            <Link href="/explore/apps" className="shrink-0 system-sm-medium text-text-accent">
              {t('learnDify.moreTemplates', { ns: 'explore' })}
            </Link>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {learnDifyItems.map(item => (
          <LearnDifyItem key={item.id} item={item} />
        ))}
      </div>
    </section>
  )
}

export default React.memo(LearnDify)
