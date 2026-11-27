import type {
  CollectionPluginsResponse,
  CollectionsAndPluginsSearchParams,
} from '@dify/contracts/marketplace'
import type { useMarketplacePlugins } from './query'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { marketplaceQuery } from '@/service/marketplace'
import { useOwnedQueryErrors } from '@/service/use-owned-query-error'
import { MARKETPLACE_CONTAINER_ID, SCROLL_BOTTOM_THRESHOLD } from './constants'
import { toListPlugin, toPluginCard } from './plugin-card-adapter'

const selectCollectionListPlugins = (response: CollectionPluginsResponse) =>
  (response.data?.plugins || []).map((plugin) => toListPlugin(toPluginCard(plugin)))

export const useMarketplacePluginsByCollectionId = (
  collectionId?: string,
  query?: CollectionsAndPluginsSearchParams,
) => {
  const collectionQuery = useQuery(
    marketplaceQuery.collectionPlugins.queryOptions({
      input: collectionId ? { params: { collectionId }, body: query ?? {} } : skipToken,
      select: selectCollectionListPlugins,
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 10,
      retry: false,
    }),
  )
  const { data, isFetching, isSuccess, isPending, refetch } = collectionQuery

  return {
    plugins: data || [],
    isLoading: !!collectionId && (isPending || (isFetching && !data)),
    isSuccess,
    refetch,
    /** For a caller that renders a failed load: pass it to `useOwnedQueryError(s)`. */
    query: collectionQuery,
  }
}

const noop = () => {}

/**
 * A failed first load of the pinned collection or of the category list, which would otherwise
 * look like a marketplace with nothing to install. A failed refetch keeps the loaded plugins.
 * Both callers render it on their install panels, so it is claimed here.
 */
export const useMarketplaceLoadFailure = (
  enabled: boolean,
  collectionQuery: ReturnType<typeof useMarketplacePluginsByCollectionId>['query'],
  pluginsQuery: ReturnType<typeof useMarketplacePlugins>,
) => {
  const load = useOwnedQueryErrors(enabled ? [collectionQuery, pluginsQuery] : [])
  return {
    loadError: load?.error ?? null,
    isRetrying: load?.retrying ?? false,
    retryLoad: load?.retry ?? noop,
  }
}

export const useMarketplaceContainerScroll = (
  callback: () => void,
  scrollContainerId = MARKETPLACE_CONTAINER_ID,
) => {
  // The callback closes over isFetching, so its identity flips on every fetch
  // boundary. Re-subscribing on each flip dropped the scroll events in that
  // window; a ref keeps one listener for the container's lifetime.
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    const container = document.getElementById(scrollContainerId)
    if (!container) return

    // scrollTop/scrollHeight/clientHeight force a synchronous layout, so
    // measuring per scroll event janks the scroll. Worse, every threshold hit
    // calls fetchNextPage, which defaults to cancelRefetch: true — a burst
    // aborts and restarts the in-flight page request, and the backend counts
    // those aborts against its search circuit breaker. One measurement per
    // frame is both smoother and quieter on the wire.
    let frame = 0
    const handleScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const { scrollTop, scrollHeight, clientHeight } = container
        if (scrollTop > 0 && scrollTop + clientHeight >= scrollHeight - SCROLL_BOTTOM_THRESHOLD)
          callbackRef.current()
      })
    }

    container.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      if (frame) cancelAnimationFrame(frame)
      container.removeEventListener('scroll', handleScroll)
    }
  }, [scrollContainerId])
}
