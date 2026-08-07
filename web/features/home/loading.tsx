'use client'

import { useSuspenseQuery } from '@tanstack/react-query'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { HomeShell } from './home-shell'
import { HomeSkeleton } from './home-skeleton'

export function HomeLoading() {
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())

  return (
    <HomeShell>
      <div className="flex flex-1 flex-col overflow-y-auto">
        <HomeSkeleton showBanner={systemFeatures.enable_explore_banner} />
      </div>
    </HomeShell>
  )
}
