'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import ContinueWorkItem from './item'

type ContinueWorkProps = {
  className?: string
}

const ContinueWork = ({
  className,
}: ContinueWorkProps) => {
  const { t } = useTranslation()
  const { data } = useQuery(consoleQuery.apps.list.queryOptions({
    input: {
      query: {
        page: 1,
        limit: 8,
        name: '',
      },
    },
    staleTime: 0,
    gcTime: 0,
  }))
  const apps = data?.data ?? []

  if (apps.length === 0)
    return null

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
        {apps.map(app => (
          <ContinueWorkItem key={app.id} app={app} />
        ))}
      </div>
    </section>
  )
}

export default React.memo(ContinueWork)
