'use client'

import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'

export function BannerSkeleton() {
  const { t } = useTranslation()

  return (
    <div
      role="status"
      aria-label={t(($) => $.loading, { ns: 'common' })}
      className="relative flex w-full flex-col items-start gap-4 px-8 pt-6 pb-4"
    >
      <div className="flex w-full flex-col gap-1">
        <SkeletonRectangle className="my-0 h-6 w-[240px] max-w-full animate-pulse" />
        <SkeletonRectangle className="my-0 h-4 w-72 max-w-full animate-pulse" />
      </div>
      <div className="@container/banner w-full">
        <SkeletonRectangle className="h-56 w-full animate-pulse rounded-2xl @min-[996px]/banner:h-46" />
      </div>
    </div>
  )
}
