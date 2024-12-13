'use client'

import type { FC, PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

const STALE_TIME = 1000 * 60 * 30 // 30 minutes

const client = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_TIME,
    },
  },
})

export const TanstackQueryIniter: FC<PropsWithChildren> = (props) => {
  const { children } = props
  return <QueryClientProvider client={client}>
    {children}
    <ReactQueryDevtools initialIsOpen={false} />
  </QueryClientProvider>
}
