'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useInfiniteQuery, useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { toast } from '@/app/notifications'
import { useRouter } from '@/next/navigation'
import { webAppQuery } from '@/service/webapp'
import { getWebAppAuthSessionSnapshot, subscribeWebAppAuthSession } from '@/service/webapp-auth'
import ProviderConnections from './provider-connections'
import ProviderHeader from './provider-header'
import { useConnectionProvider } from './use-connection-provider'

export default function ProviderConnectionsPage({ providerId }: { providerId: string }) {
  const { t } = useTranslation(['app', 'common'])
  const router = useRouter()
  const hasRedirectedRef = useRef(false)
  const authSession = useSyncExternalStore(
    subscribeWebAppAuthSession,
    getWebAppAuthSessionSnapshot,
    () => 0,
  )
  const input = (cursor: string | undefined) => ({
    params: { provider: providerId },
    query: { limit: 100, cursor },
  })
  const context = { authSession, silent: true }
  const list = useInfiniteQuery(
    webAppQuery.me.connections.providers.byProvider.connections.get.infiniteOptions({
      input,
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (page, _pages, cursor, cursors) => {
        const next = page.has_more ? page.next_cursor : null
        return next && next !== cursor && !cursors.includes(next) ? next : undefined
      },
      queryKey: [
        ...webAppQuery.me.connections.providers.byProvider.connections.get.key({
          type: 'infinite',
          input: input(undefined),
        }),
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
  const metadata = useConnectionProvider(providerId, authSession)
  const provider = metadata.data ?? { provider: providerId }
  const error = list.error ?? metadata.error
  const noConnections =
    list.isSuccess && !list.isFetching && !list.hasNextPage && connections.length === 0

  useEffect(() => {
    if (!noConnections || hasRedirectedRef.current) return
    hasRedirectedRef.current = true
    toast.info(t(($) => $['endUser.noProviderConnections'], { ns: 'app' }))
    router.replace('/connections')
  }, [noConnections, router, t])

  if (metadata.isPending || list.isPending || noConnections)
    return <LoadingPlaceholder className="py-8" />

  return (
    <>
      <ProviderHeader provider={provider} />
      <div className="space-y-4 px-5 pt-2 pb-8 sm:px-8">
        {(list.isError || metadata.isError) && (
          <div className="space-y-2">
            <p role="alert" className="system-sm-regular text-text-destructive">
              {error?.message || t(($) => $['api.actionFailed'], { ns: 'common' })}
            </p>
            <Button
              onClick={() => {
                if (list.isError) void list.refetch()
                if (metadata.isError) void metadata.refetch()
              }}
            >
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
