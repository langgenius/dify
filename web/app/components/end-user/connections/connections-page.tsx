'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { webAppQuery } from '@/service/webapp'
import { getWebAppAuthSessionSnapshot, subscribeWebAppAuthSession } from '@/service/webapp-auth'
import Connections from '.'
import EmptyState from '../empty-state'

export default function ConnectionsPage() {
  const { t } = useTranslation(['app', 'common'])
  const authSession = useSyncExternalStore(
    subscribeWebAppAuthSession,
    getWebAppAuthSessionSnapshot,
    () => 0,
  )
  const input = (cursor: string | undefined) => ({ query: { limit: 100, cursor } })
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
      context: { authSession, silent: true },
      retry: false,
      gcTime: 0,
    }),
  )
  const providers = list.data?.pages.flatMap((page) => page.data) ?? []

  return (
    <>
      <Connections providers={providers} />
      <div className="px-5 pb-8 sm:px-8">
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
        {list.isSuccess && providers.length === 0 && (
          <EmptyState
            title={t(($) => $['endUser.noProviderConnections'], { ns: 'app' })}
            description={t(($) => $['endUser.connectionsDescription'], { ns: 'app' })}
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
