import type { QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { createElement, useLayoutEffect, useMemo } from 'react'
import { seedRegisteredConsoleStateFixture } from '@/test/console/state-fixture'

export function QueryClientTestProvider({
  children,
  queryClient,
}: {
  children?: ReactNode
  queryClient: QueryClient
}) {
  const store = useMemo(() => {
    const nextStore = createStore()
    nextStore.set(queryClientAtom, queryClient)
    seedRegisteredConsoleStateFixture(nextStore)
    return nextStore
  }, [queryClient])

  useLayoutEffect(() => {
    seedRegisteredConsoleStateFixture(store)
  })

  return createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(Provider, { store }, children),
  )
}
