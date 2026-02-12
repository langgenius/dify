import type { SearchParams } from 'nuqs'
import { HydrationBoundary } from '@tanstack/react-query'

// The server side logic should move to marketplace's codebase so that we can get rid of Next.js

export async function HydrateQueryClient({
  // eslint-disable-next-line unused-imports/no-unused-vars
  searchParams,
  children,
}: {
  searchParams: Promise<SearchParams> | undefined
  children: React.ReactNode
}) {
  // TODO: bring back dehydrated state
  return (
    <HydrationBoundary state={null}>
      {children}
    </HydrationBoundary>
  )
}
