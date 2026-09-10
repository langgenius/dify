import { dehydrate, HydrationBoundary, noop } from '@tanstack/react-query'
import { Suspense } from 'react'
import { getQueryClient } from '@/app/get-query-client'
import { getOptionalSystemFeatures } from '@/features/system-features/server'
import { getLocaleOnServer } from '@/i18n-config/server'
import { consoleQuery } from '@/service/console'
import { HomeContent } from './home-content/home-content'
import { HomeShell } from './home-shell'
import { HomeSkeleton } from './home-skeleton'

export async function HomePage() {
  const homeQueryClient = getQueryClient()
  const locale = await getLocaleOnServer()

  void homeQueryClient
    .query(
      consoleQuery.explore.apps.get.queryOptions({
        input: { query: { language: locale } },
      }),
    )
    .catch(noop)
  void homeQueryClient
    .query(
      consoleQuery.apps.recent.get.queryOptions({
        input: { query: { limit: 8 } },
      }),
    )
    .catch(noop)

  const enableExploreBanner = (await getOptionalSystemFeatures())?.enable_explore_banner ?? false
  if (enableExploreBanner) {
    void homeQueryClient
      .query(
        consoleQuery.explore.banners.get.queryOptions({
          input: { query: { language: locale } },
        }),
      )
      .catch(noop)
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
