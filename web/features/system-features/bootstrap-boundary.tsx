'use client'

import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FullScreenLoading } from '@/app/components/full-screen-loading'
import { isClient } from '@/utils/client'
import { systemFeaturesQueryOptions } from './client'

export function SystemFeaturesBootstrapBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common')
  const { data, error, isFetching, refetch } = useQuery({
    ...systemFeaturesQueryOptions(),
    enabled: isClient,
  })

  if (data) return children
  if (!error || isFetching) return <FullScreenLoading />

  return (
    <div className="flex min-h-dvh w-full flex-1 flex-col items-center justify-center gap-4 bg-background-body">
      <div role="alert" className="system-sm-regular text-text-tertiary">
        {t(($) => $['errorBoundary.message'])}
      </div>
      <Button size="small" variant="secondary" onClick={() => void refetch()}>
        {t(($) => $['errorBoundary.tryAgain'])}
      </Button>
    </div>
  )
}
