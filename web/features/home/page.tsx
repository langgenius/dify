import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { Suspense } from 'react'
import { getQueryClient } from '@/app/get-query-client'
import {
  getSystemFeaturesQueryClient,
  systemFeaturesServerQueryOptions,
} from '@/features/system-features/server'
import { getLocaleOnServer } from '@/i18n-config/server'
import { cacheLife } from '@/next/cache'
import { getServerConsoleClientContext, serverConsoleQuery } from '@/service/server'
import { HomeContent } from './home-content/home-content'
import { HomePageSkeleton } from './home-skeleton'

export function HomePage() {
  return (
    <Suspense fallback={<HomePageSkeleton />}>
      <HomeData />
    </Suspense>
  )
}

async function HomeData() {
  'use cache: private'
  cacheLife('minutes')

  const queryClient = getQueryClient()
  const [locale, context, systemFeatures] = await Promise.all([
    getLocaleOnServer(),
    getServerConsoleClientContext(),
    getSystemFeaturesQueryClient().ensureQueryData(systemFeaturesServerQueryOptions()),
  ])

  const homeQueryPromises = [
    queryClient.prefetchQuery(
      serverConsoleQuery.explore.apps.get.queryOptions({
        context,
        input: { query: { language: locale } },
      }),
    ),
    queryClient.prefetchQuery(
      serverConsoleQuery.apps.recent.get.queryOptions({
        context,
        input: { query: { limit: 8 } },
      }),
    ),
  ]

  if (systemFeatures.enable_explore_banner) {
    homeQueryPromises.push(
      queryClient.prefetchQuery(
        serverConsoleQuery.explore.banners.get.queryOptions({
          context,
          input: { query: { language: locale } },
        }),
      ),
    )
  }

  await Promise.all(homeQueryPromises)

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <HomeContent />
    </HydrationBoundary>
  )
}
