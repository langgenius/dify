'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useInfiniteQuery, useMutation } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { webAppQuery } from '@/service/webapp'
import { getWebAppAuthSessionSnapshot, subscribeWebAppAuthSession } from '@/service/webapp-auth'
import ProviderConnections from './provider-connections'
import ProviderHeader from './provider-header'

export default function ProviderConnectionsPage({ providerId }: { providerId: string }) {
  const { t } = useTranslation(['common'])
  const authSession = useSyncExternalStore(
    subscribeWebAppAuthSession,
    getWebAppAuthSessionSnapshot,
    () => 0,
  )
  const input = (cursor: string | undefined) => ({
    query: { provider: providerId, limit: 100, cursor },
  })
  const context = { authSession, silent: true }
  const list = useInfiniteQuery(
    webAppQuery.me.connections.get.infiniteOptions({
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
      context,
      retry: false,
      gcTime: 0,
    }),
  )
  const removal = useMutation(
    webAppQuery.me.connections.byConnectionKey.delete.mutationOptions({ context }),
  )
  const connections = Array.from(
    new Map(
      list.data?.pages.flatMap((page) =>
        page.data.map((connection) => [connection.key, connection] as const),
      ),
    ).values(),
  )
  const provider = { id: providerId }

  return (
    <>
      <ProviderHeader provider={provider} />
      <div className="space-y-4 px-5 pt-2 pb-8 sm:px-8">
        {list.isPending && <p role="status">{t(($) => $.loading, { ns: 'common' })}</p>}
        {list.isError && (
          <div className="space-y-2">
            <p role="alert" className="system-sm-regular text-text-destructive">
              {list.error.message || t(($) => $['api.actionFailed'], { ns: 'common' })}
            </p>
            <Button onClick={() => list.refetch()}>
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </div>
        )}
        {list.data && (
          <ProviderConnections
            key={`${providerId}:${authSession}`}
            provider={provider}
            connections={connections}
            onRemove={async (connection) => {
              await removal.mutateAsync({ params: { connection_key: connection.key } })
            }}
          />
        )}
        {list.hasNextPage && (
          <Button loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
            {t(($) => $['operation.viewMore'], { ns: 'common' })}
          </Button>
        )}
      </div>
    </>
  )
}
