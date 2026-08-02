import type { ReactNode } from 'react'
import { defaultShouldDehydrateQuery, dehydrate, HydrationBoundary } from '@tanstack/react-query'
import {
  getHomeContinueWorkServerQueryOptions,
  getHomeTemplatesServerQueryOptions,
} from '@/app/components/explore/app-list/home-queries-server'
import { makeQueryClient } from '@/context/query-client-server'
import { getLocaleOnServer } from '@/i18n-config/server'
import { getServerConsoleClientContext, resolveServerConsoleApiUrl } from '@/service/server'

const HOME_TEMPLATES_PATH = '/explore/apps'

export async function HomeHydrationBoundary({ children }: { children: ReactNode }) {
  const queryClient = makeQueryClient()

  if (resolveServerConsoleApiUrl(HOME_TEMPLATES_PATH)) {
    try {
      const [locale, context] = await Promise.all([
        getLocaleOnServer(),
        getServerConsoleClientContext(),
      ])

      void queryClient.prefetchQuery(getHomeTemplatesServerQueryOptions(locale, context))
      void queryClient.prefetchQuery(getHomeContinueWorkServerQueryOptions(context))
    } catch {
      // Keep the existing client query and retry behavior when SSR prefetch is unavailable.
    }
  }

  return (
    <HydrationBoundary
      state={dehydrate(queryClient, {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
      })}
    >
      {children}
    </HydrationBoundary>
  )
}
