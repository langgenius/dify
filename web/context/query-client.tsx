'use client'

import type { QueryClient } from '@tanstack/react-query'
import type { FC, PropsWithChildren } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { TanStackDevtoolsLoader } from '@/app/components/devtools/tanstack/loader'
import { makeQueryClient } from './query-client-server'

let browserQueryClient: QueryClient | undefined

function getQueryClient() {
  if (typeof window === 'undefined') {
    // Server: always make a new query client
    return makeQueryClient()
  }
  // Browser: make a new query client if we don't already have one
  if (!browserQueryClient)
    browserQueryClient = makeQueryClient()
  return browserQueryClient
}

export const TanstackQueryInner: FC<PropsWithChildren> = ({ children }) => {
  // Use useState to ensure stable QueryClient across re-renders
  const [queryClient] = useState(getQueryClient)
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <TanStackDevtoolsLoader />
    </QueryClientProvider>
  )
}

/**
 * @deprecated Use TanstackQueryInner instead for new code
 */
export const TanstackQueryInitializer = TanstackQueryInner
