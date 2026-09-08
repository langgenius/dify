'use client'

import { useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { userProfileQueryOptions } from '@/features/account-profile/client'

export function HomeIntroSkeleton() {
  return (
    <div className="flex w-full flex-col gap-1 px-8 pt-6 pb-4">
      <SkeletonRectangle className="my-0 h-6 w-60 max-w-full animate-pulse" />
      <SkeletonRectangle className="my-0 h-4 w-72 max-w-full animate-pulse" />
    </div>
  )
}

export function HomeIntro() {
  const { t } = useTranslation()
  const { data: userProfile } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile,
  })

  return (
    <header className="flex w-full flex-col gap-1 px-8 pt-6 pb-4">
      <h1 className="truncate title-3xl-semi-bold text-text-primary">
        {t(($) => $['banner.greeting'], { name: userProfile.name, ns: 'explore' })}
      </h1>
      <p className="truncate body-sm-regular text-text-secondary">
        {t(($) => $['banner.tagline'], { ns: 'explore' })}
      </p>
    </header>
  )
}
