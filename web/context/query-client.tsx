'use client'

import type { QueryClient } from '@tanstack/react-query'
import { QueryClientProvider, QueryErrorResetBoundary } from '@tanstack/react-query'
import { queryClientAtom } from 'jotai-tanstack-query'
import { useHydrateAtoms } from 'jotai/react/utils'
import { isServer } from '@/utils/client'
import { makeQueryClient } from './query-client-server'

let browserQueryClient: QueryClient | undefined

function getQueryClient() {
  if (isServer) {
    return makeQueryClient()
  }
  if (!browserQueryClient) browserQueryClient = makeQueryClient()
  return browserQueryClient
}

export const TanstackQueryInitializer = ({ children }: { children: React.ReactNode }) => {
  const queryClient = getQueryClient()
  return (
    <QueryClientProvider client={queryClient}>
      <QueryErrorResetBoundary>
        <HydrateJotaiQueryClient queryClient={queryClient}>{children}</HydrateJotaiQueryClient>
      </QueryErrorResetBoundary>
    </QueryClientProvider>
  )
}

function HydrateJotaiQueryClient({
  children,
  queryClient,
}: {
  children: React.ReactNode
  queryClient: QueryClient
}) {
  useHydrateAtoms(new Map([[queryClientAtom, queryClient]]))

  return children
}
