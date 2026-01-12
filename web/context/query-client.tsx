'use client'

import type { QueryClient } from '@tanstack/react-query'
import type { FC, PropsWithChildren } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { TanStackDevtoolsLoader } from '@/app/components/devtools/tanstack/loader'
import { isServer } from '@/utils/client'
import { makeQueryClient } from './query-client-server'

let browserQueryClient: QueryClient | undefined

function getQueryClient() {
  if (isServer) {
    return makeQueryClient()
  }
  if (!browserQueryClient)
    browserQueryClient = makeQueryClient()
  return browserQueryClient
}

export const TanstackQueryInitializer: FC<PropsWithChildren> = ({ children }) => {
  const [queryClient] = useState(getQueryClient)
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <TanStackDevtoolsLoader />
    </QueryClientProvider>
  )
}
