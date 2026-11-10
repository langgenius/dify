'use client'

import { Button } from '@langgenius/dify-ui/button'
import { createDialogHandle, Dialog } from '@langgenius/dify-ui/dialog'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { parseAsStringLiteral, useQueryState, useQueryStates } from 'nuqs'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppCardSkeleton } from '@/app/components/apps/app-card-skeleton'
import { APP_LIST_GRID_CLASS_NAME } from '@/app/components/apps/constants'
import { appListQueryParsers } from '@/app/components/apps/query-params'
import AppUnavailable from '@/app/components/base/app-unavailable'
import InstalledAppDialogContent from '@/app/components/explore/installed-app/dialog'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { consoleQuery } from '@/service/console'
import { hasPermission } from '@/utils/permission'
import PublishedAppCard from './app-card'
import PublishedAppsToolbar from './toolbar'

function PublishedAppsList() {
  const { t } = useTranslation(['common', 'navigation'])
  const [view, setView] = useQueryState(
    'view',
    parseAsStringLiteral(['all', 'starred']).withDefault('all'),
  )
  const [filters, setFilters] = useQueryStates({
    category: appListQueryParsers.category,
    sort_by: appListQueryParsers.sort_by,
  })
  const { category, sort_by: sortBy } = filters
  const [dialog] = useState(() => createDialogHandle<string>())
  const list = useInfiniteQuery(
    consoleQuery.installedApps.get.infiniteOptions({
      input: (cursor: string | undefined) => ({
        query: { limit: 100, cursor, mode: category, sort_by: sortBy },
      }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (page, _pages, cursor, cursors) => {
        const next = page.has_more ? page.next_cursor : null
        return next && next !== cursor && !cursors.includes(next) ? next : undefined
      },
    }),
  )
  const { hasNextPage, isFetching, isError, fetchNextPage } = list
  useEffect(() => {
    if (hasNextPage && !isFetching && !isError) void fetchNextPage().catch(() => {})
  }, [hasNextPage, isFetching, isError, fetchNextPage])
  const apps = list.data?.pages.flatMap((page) => page.installed_apps) ?? []
  const visibleApps = view === 'starred' ? apps.filter((app) => app.is_pinned) : apps
  const loading = list.isPending || (list.hasNextPage && !list.isError)

  return (
    <div className="h-full overflow-y-auto bg-background-body pb-8">
      <header className="space-y-1 px-8 py-4">
        <h1 className="title-3xl-semi-bold text-text-primary">
          {t(($) => $['mainNav.publishedApps'], { ns: 'navigation' })}
        </h1>
        <p className="body-sm-regular text-text-secondary">
          {t(($) => $['mainNav.publishedAppsDescription'], { ns: 'navigation' })}
        </p>
      </header>
      <PublishedAppsToolbar
        view={view}
        category={category}
        sortBy={sortBy}
        onCategoryChange={(next) => {
          void setFilters({ category: next })
        }}
        onSortChange={(next) => {
          void setFilters({ sort_by: next })
        }}
        onViewChange={(next) => {
          void setView(next)
        }}
      />
      {list.isError && (
        <div className="space-y-2 px-8 py-4">
          <p role="alert" className="system-sm-regular text-text-destructive">
            {list.error.message}
          </p>
          <Button onClick={() => list.refetch()}>
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </div>
      )}
      {loading ? (
        <ul
          className={APP_LIST_GRID_CLASS_NAME}
          aria-label={t(($) => $.loading, { ns: 'common' })}
          aria-busy="true"
        >
          <AppCardSkeleton count={4} />
        </ul>
      ) : visibleApps.length ? (
        <ul className={APP_LIST_GRID_CLASS_NAME}>
          {visibleApps.map((app) => (
            <PublishedAppCard key={app.id} app={app} dialog={dialog} />
          ))}
        </ul>
      ) : !list.isError ? (
        <p role="status" className="px-8 py-8 text-center system-sm-regular text-text-tertiary">
          {t(($) => $['mainNav.webApps.noResults'], { ns: 'navigation' })}
        </p>
      ) : null}
      <Dialog handle={dialog}>
        {({ payload }) => (payload ? <InstalledAppDialogContent appId={payload} /> : null)}
      </Dialog>
    </div>
  )
}

export default function PublishedApps() {
  const keys = useAtomValue(workspacePermissionKeysAtom)
  if (!hasPermission(keys, 'app_library.access')) return <AppUnavailable code={403} />
  return <PublishedAppsList />
}
