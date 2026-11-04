import { webAppQuery } from '@/service/webapp'

export function connectionProvidersQueryOptions(authSession: number) {
  const input = (cursor: string | undefined) => ({ query: { limit: 100, cursor } })
  return webAppQuery.me.connections.get.infiniteOptions({
    input,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page, _pages, cursor, cursors) => {
      const next = page.has_more ? page.next_cursor : null
      return next && next !== cursor && !cursors.includes(next) ? next : undefined
    },
    queryKey: [
      ...webAppQuery.me.connections.get.key({ type: 'infinite', input: input(undefined) }),
      authSession,
    ],
    context: { authSession, silent: true },
    retry: false,
    gcTime: 0,
  })
}
