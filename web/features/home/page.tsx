import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { Suspense } from 'react'
import { getQueryClient } from '@/app/get-query-client'
import { ensureSystemFeatures } from '@/features/system-features/server'
import { getLocaleOnServer } from '@/i18n-config/server'
import { getServerConsoleClientContext, serverConsoleQuery } from '@/service/server'
import { HomeContent } from './home-content/home-content'
import { HomeShell } from './home-shell'
import { HomeSkeleton } from './home-skeleton'

export async function HomePage() {
  const homeQueryClient = getQueryClient()
  const [locale, context] = await Promise.all([
    getLocaleOnServer(),
    getServerConsoleClientContext(),
  ])

  void homeQueryClient.prefetchQuery(
    serverConsoleQuery.explore.apps.get.queryOptions({
      context,
      input: { query: { language: locale } },
    }),
  )
  void homeQueryClient.prefetchQuery(
    serverConsoleQuery.apps.recent.get.queryOptions({
      context,
      input: { query: { limit: 8 } },
    }),
  )

  const enableExploreBanner = (await ensureSystemFeatures()).enable_explore_banner
  if (enableExploreBanner) {
    void homeQueryClient.prefetchQuery(
      serverConsoleQuery.explore.banners.get.queryOptions({
        context,
        input: { query: { language: locale } },
      }),
    )
  }

  const dehydratedState = dehydrate(homeQueryClient)

  return (
    <HydrationBoundary state={dehydratedState}>
      <Suspense
        fallback={
          <HomeShell>
            <div className="flex flex-1 flex-col overflow-y-auto">
              <HomeSkeleton showBanner={enableExploreBanner} />
            </div>
          </HomeShell>
        }
      >
        <HomeContent />
      </Suspense>
    </HydrationBoundary>
  )
}
