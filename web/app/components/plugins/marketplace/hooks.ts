import type {
  CollectionPluginsResponse,
  CollectionsAndPluginsSearchParams,
} from '@dify/contracts/marketplace'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { marketplaceQuery } from '@/service/marketplace'
import { MARKETPLACE_CONTAINER_ID, SCROLL_BOTTOM_THRESHOLD } from './constants'
import { toListPlugin, toPluginCard } from './plugin-card-adapter'

const selectCollectionListPlugins = (response: CollectionPluginsResponse) =>
  (response.data?.plugins || []).map((plugin) => toListPlugin(toPluginCard(plugin)))

export const useMarketplacePluginsByCollectionId = (
  collectionId?: string,
  query?: CollectionsAndPluginsSearchParams,
) => {
  const { data, isFetching, isSuccess, isPending } = useQuery(
    marketplaceQuery.collectionPlugins.queryOptions({
      input: collectionId ? { params: { collectionId }, body: query ?? {} } : skipToken,
      select: selectCollectionListPlugins,
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 10,
      retry: false,
    }),
  )

  return {
    plugins: data || [],
    isLoading: !!collectionId && (isPending || (isFetching && !data)),
    isSuccess,
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
