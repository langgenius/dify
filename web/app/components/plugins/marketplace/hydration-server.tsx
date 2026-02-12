import type { SearchParams } from 'nuqs'
import { HydrationBoundary } from '@tanstack/react-query'

export type Awaitable<T> = T | PromiseLike<T>

export async function HydrateQueryClient({
  // eslint-disable-next-line unused-imports/no-unused-vars
  params,
  // eslint-disable-next-line unused-imports/no-unused-vars
  searchParams,
  children,
}: {
  params?: Awaitable<{ category?: string, creationType?: string, searchTab?: string } | undefined>
  searchParams?: Awaitable<SearchParams>
  children: React.ReactNode
}) {
  // TODO: bring back dehydrated state
  return (
    <HydrationBoundary state={null}>
      {children}
    </HydrationBoundary>
  )
}
