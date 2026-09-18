import type { DehydratedState } from '@tanstack/react-query'
import type { SearchParams } from 'nuqs/server'
import { HydrationBoundary } from '@tanstack/react-query'
import { prefetchMarketplaceDehydratedState } from './prefetch-marketplace-dehydrated-state'

export async function HydrateQueryClient({
  searchParams,
  prefetchedState,
  children,
}: {
  searchParams: Promise<SearchParams> | undefined
  prefetchedState?: DehydratedState
  children: React.ReactNode
}) {
  const dehydratedState =
    prefetchedState === undefined
      ? await prefetchMarketplaceDehydratedState(searchParams)
      : prefetchedState
  return <HydrationBoundary state={dehydratedState}>{children}</HydrationBoundary>
}
