'use client'

import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from '@/next/navigation'
import { isInitialSourceForOperation } from './source-models'
import {
  currentSourcesAtom,
  fetchNextSourcePageAtom,
  loadedSourcePageCountAtom,
  markSourcePollingTimedOutAtom,
  shouldAutoLoadNextSourcePageAtom,
  sourcesAwaitedOperationIdAtom,
  sourcesPollingPhaseAtom,
} from './state'

const INITIAL_SOURCE_POLL_TIMEOUT = 10 * 60 * 1000

export function SourcesRuntimeController() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const awaitedOperationId = useAtomValue(sourcesAwaitedOperationIdAtom)
  const currentSources = useAtomValue(currentSourcesAtom)
  const pollingPhase = useAtomValue(sourcesPollingPhaseAtom)
  const shouldAutoLoadNextSourcePage = useAtomValue(shouldAutoLoadNextSourcePageAtom)
  const loadedSourcePageCount = useAtomValue(loadedSourcePageCountAtom)
  const fetchNextSourcePage = useSetAtom(fetchNextSourcePageAtom)
  const markPollingTimedOut = useSetAtom(markSourcePollingTimedOutAtom)

  useEffect(() => {
    if (
      awaitedOperationId &&
      currentSources.some((source) => isInitialSourceForOperation(source, awaitedOperationId))
    ) {
      const nextSearchParams = new URLSearchParams(searchParams)
      nextSearchParams.delete('awaitInitialSource')
      const queryString = nextSearchParams.toString()
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false })
    }
  }, [awaitedOperationId, currentSources, pathname, router, searchParams])

  useEffect(() => {
    if (pollingPhase !== 'awaiting' && pollingPhase !== 'initializing') return
    const timeout = globalThis.setTimeout(markPollingTimedOut, INITIAL_SOURCE_POLL_TIMEOUT)
    return () => globalThis.clearTimeout(timeout)
  }, [awaitedOperationId, markPollingTimedOut, pollingPhase])

  // Re-evaluate after every loaded page: a fast response can complete within one render, so the
  // auto-load condition may stay true without ever flipping while the page is fetched.
  useEffect(() => {
    if (shouldAutoLoadNextSourcePage) void fetchNextSourcePage()
  }, [fetchNextSourcePage, loadedSourcePageCount, shouldAutoLoadNextSourcePage])

  return null
}
