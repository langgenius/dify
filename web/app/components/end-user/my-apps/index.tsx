'use client'

import type { EndUserApp, RemoveAppRequest } from './model'
import { useQueryStates } from 'nuqs'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import EmptyState from '../empty-state'
import AppGrid from './app-grid'
import { selectApps } from './model'
import { myAppsQueryParsers } from './query-params'
import RemoveAppDialog from './remove-app-dialog'
import MyAppsToolbar from './toolbar'

export type MyAppsProps = {
  apps: readonly EndUserApp[]
  getAppHref: (app: EndUserApp) => string
  onToggleStar: (id: string) => void
  onRemoveApp: (request: RemoveAppRequest) => void | Promise<void>
}

export default function MyApps({ apps, getAppHref, onToggleStar, onRemoveApp }: MyAppsProps) {
  const { t, i18n } = useTranslation(['app'])
  const [filter, setFilter] = useQueryStates(myAppsQueryParsers)
  const [removal, setRemoval] = useState<RemoveAppRequest | null>(null)
  const [removalOpen, setRemovalOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const removalSucceededRef = useRef(false)
  const visibleApps = selectApps(apps, filter, i18n.language)
  const noSearchResults = apps.length > 0 && visibleApps.length === 0 && !!filter.q.trim()
  const emptyTitle = noSearchResults
    ? t(($) => $['endUser.noResults'], { ns: 'app' })
    : t(($) => $['endUser.emptyApps'], { ns: 'app' })
  const emptyDescription = noSearchResults
    ? t(($) => $['endUser.noResultsDescription'], { ns: 'app' })
    : t(($) => $['endUser.emptyAppsDescription'], { ns: 'app' })
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
        {visibleApps.length > 0 ? (
          <AppGrid
            apps={visibleApps}
            getAppHref={getAppHref}
            onToggleStar={onToggleStar}
            onRemove={(request) => {
              removalSucceededRef.current = false
              setRemoval(request)
              setRemovalOpen(true)
            }}
          />
        ) : (
          <EmptyState title={emptyTitle} description={emptyDescription} />
        )}
      </div>
      <RemoveAppDialog
        request={removal}
        open={removalOpen}
        finalFocus={() => (removalSucceededRef.current ? (searchInputRef.current ?? true) : true)}
        onCancel={() => setRemovalOpen(false)}
        onConfirm={async (request) => {
          await onRemoveApp(request)
          removalSucceededRef.current = true
        }}
      />
    </>
  )
}
