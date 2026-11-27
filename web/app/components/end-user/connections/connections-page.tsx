'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { getWebAppAuthSessionSnapshot, subscribeWebAppAuthSession } from '@/service/webapp-auth'
import Connections from '.'
import EmptyState from '../empty-state'
import { connectionProvidersQueryOptions } from './connection-providers-query'

export default function ConnectionsPage() {
  const { t } = useTranslation(['app', 'common'])
  const authSession = useSyncExternalStore(
    subscribeWebAppAuthSession,
    getWebAppAuthSessionSnapshot,
    () => 0,
  )
  const list = useInfiniteQuery(connectionProvidersQueryOptions(authSession))
  const providers = list.data?.pages.flatMap((page) => page.data) ?? []

  return (
    <>
      <Connections providers={providers} />
      <div className="px-5 pb-8 sm:px-8">
        {list.isPending && <LoadingPlaceholder className="py-8" />}
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
