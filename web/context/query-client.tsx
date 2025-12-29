'use client'

import type { FC, PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { IS_DEV } from '@/config'

const TanStackDevtoolsWrapper = lazy(() =>
  import('@/app/components/devtools').then(module => ({
    default: module.TanStackDevtoolsWrapper,
  })),
)

const STALE_TIME = 1000 * 60 * 30 // 30 minutes

const client = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_TIME,
    },
  },
})

export const TanstackQueryInitializer: FC<PropsWithChildren> = (props) => {
  const { children } = props
  return (
    <QueryClientProvider client={client}>
      {children}
      {IS_DEV && (
        <Suspense fallback={null}>
          <TanStackDevtoolsWrapper />
        </Suspense>
      )}
    </QueryClientProvider>
  )
}
