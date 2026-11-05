import type { ConsumerConnectionProvidersResponse } from '@dify/contracts/api/web/types.gen'
import type { InfiniteData } from '@tanstack/react-query'
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { webAppClient, webAppQuery } from '@/service/webapp'
import { connectionProvidersQueryOptions } from './connection-providers-query'

export function useConnectionProvider(providerId: string, authSession: number) {
  const { t } = useTranslation(['common'])
  const queryClient = useQueryClient()
  return useQuery(
    queryOptions({
      queryKey: [...webAppQuery.me.connections.key(), 'provider-metadata', providerId, authSession],
      initialData: () =>
        queryClient
          .getQueryData<InfiniteData<ConsumerConnectionProvidersResponse>>(
            connectionProvidersQueryOptions(authSession).queryKey,
          )
          ?.pages.flatMap((page) => page.data)
          .find((provider) => provider.provider === providerId),
      queryFn: async ({ signal }) => {
        let cursor: string | undefined
        const cursors = new Set<string>()
        do {
          const page = await webAppClient.me.connections.get(
            { query: { limit: 100, cursor } },
            { signal, context: { authSession, silent: true } },
          )
          const provider = page.data.find((item) => item.provider === providerId)
          if (provider) return provider
          if (!page.has_more) return null
          const next = page.next_cursor
          if (!next || cursors.has(next))
            throw new Error(t(($) => $['api.actionFailed'], { ns: 'common' }))
          cursors.add(next)
          cursor = next
        } while (cursor)
        return null
      },
      retry: false,
      gcTime: 0,
    }),
  )
}
