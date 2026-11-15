import type { QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { QueryClientTestProvider } from '@/test/console/query-provider'

export const createQueryClientWrapper = (queryClient: QueryClient) => {
  return function QueryClientWrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientTestProvider, { queryClient }, children)
  }
}
