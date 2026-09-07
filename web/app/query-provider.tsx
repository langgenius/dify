'use client'

import type { QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { QueryClientProvider, QueryErrorResetBoundary } from '@tanstack/react-query'
import { queryClientAtom } from 'jotai-tanstack-query'
import { useHydrateAtoms } from 'jotai/react/utils'
import { getQueryClient } from './get-query-client'

export function TanStackQueryProvider({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient()

  return (
    <QueryClientProvider client={queryClient}>
      <QueryErrorResetBoundary>
        <JotaiQueryClientHydrator queryClient={queryClient}>{children}</JotaiQueryClientHydrator>
      </QueryErrorResetBoundary>
    </QueryClientProvider>
  )
}

function JotaiQueryClientHydrator({
  children,
  queryClient,
}: {
  children: ReactNode
  queryClient: QueryClient
}) {
  useHydrateAtoms(new Map([[queryClientAtom, queryClient]]))

  return children
}
