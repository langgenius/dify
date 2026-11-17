'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useQueryStates } from 'nuqs'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { webAppQuery } from '@/service/webapp'
import { getWebAppAuthSessionSnapshot, subscribeWebAppAuthSession } from '@/service/webapp-auth'
import EmptyState from '../empty-state'
import AppGrid from './app-grid'
import { sortApps } from './model'
import { myAppsQueryParsers } from './query-params'
import MyAppsToolbar from './toolbar'

export default function MyApps() {
  const { t, i18n } = useTranslation(['app', 'common'])
  const [filter, setFilter] = useQueryStates(myAppsQueryParsers)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const name = useDebounce(filter.q.trim(), { wait: 300 })
  const authSession = useSyncExternalStore(
    subscribeWebAppAuthSession,
    getWebAppAuthSessionSnapshot,
    getWebAppAuthSessionSnapshot,
  )
  const views = { all: 'recent', starred: 'favorites' } as const
  const view = views[filter.view]
  const listInput = (cursor: string | undefined) => ({
    query: { view, name: name || undefined, cursor, limit: 100 },
  })
  const list = useInfiniteQuery(
    webAppQuery.me.apps.get.infiniteOptions({
      input: listInput,
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage, _pages, cursor, cursors) => {
        const next = lastPage.has_more ? lastPage.next_cursor : null
        return next && next !== cursor && !cursors.includes(next) ? next : undefined
      },
      queryKey: [
        ...webAppQuery.me.apps.get.key({ type: 'infinite', input: listInput(undefined) }),
        authSession,
      ],
      context: { authSession, silent: true },
      retry: false,
      staleTime: 0,
      gcTime: 0,
    }),
  )
  const { hasNextPage, isFetching, isError, fetchNextPage } = list
  useEffect(() => {
    if (hasNextPage && !isFetching && !isError) void fetchNextPage().catch(() => {})
  }, [hasNextPage, isFetching, isError, fetchNextPage])

  const incompletePage = !!list.data?.pages.at(-1)?.has_more && !list.hasNextPage
  const failed = list.isError || incompletePage
  const loading = list.isPending || (!list.isError && list.hasNextPage) || name !== filter.q.trim()
  const apps = sortApps(
    list.data?.pages.flatMap((page) => page.data) ?? [],
    filter.sort,
    i18n.language,
  )
  const noSearchResults = !!name

  return (
    <>
      <header className="min-h-15.5 px-5 pt-3.5 pb-4 sm:px-8">
        <h1 className="title-3xl-semi-bold text-text-primary">
          {t(($) => $['endUser.myApps'], { ns: 'app' })}
        </h1>
      </header>
      <div className="space-y-3 px-5 pb-8 sm:px-8">
        <MyAppsToolbar
          filter={filter}
          searchInputRef={searchInputRef}
          onFilterChange={(next) => {
            void setFilter(next)
          }}
        />
        {failed ? null : loading ? (
          <p role="status" className="py-8 text-center system-sm-regular text-text-tertiary">
            {t(($) => $.loading, { ns: 'common' })}
          </p>
        ) : apps.length > 0 ? (
          <AppGrid apps={apps} authSession={authSession} />
        ) : (
          <EmptyState
            title={
              noSearchResults
                ? t(($) => $['endUser.noResults'], { ns: 'app' })
                : filter.view === 'starred'
                  ? t(($) => $['endUser.emptyStarredApps'], { ns: 'app' })
                  : t(($) => $['endUser.emptyApps'], { ns: 'app' })
            }
            description={
              noSearchResults
                ? t(($) => $['endUser.noResultsDescription'], { ns: 'app' })
                : filter.view === 'starred'
                  ? t(($) => $['endUser.emptyStarredAppsDescription'], { ns: 'app' })
                  : t(($) => $['endUser.emptyAppsDescription'], { ns: 'app' })
            }
          />
        )}
      </div>
    </>
  )
}
