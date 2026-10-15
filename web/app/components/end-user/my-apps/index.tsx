'use client'

import type { EndUserApp, RemoveAppRequest } from './model'
import { Button } from '@langgenius/dify-ui/button'
import { useQueryStates } from 'nuqs'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppGrid from './app-grid'
import { selectApps } from './model'
import { myAppsQueryParsers } from './query-params'
import RemoveAppDialog from './remove-app-dialog'
import MyAppsToolbar from './toolbar'

export type MyAppsProps = {
  apps: readonly EndUserApp[]
  onOpenApp: (app: EndUserApp) => void
  onToggleStar: (id: string) => void
  onRemoveApp: (request: RemoveAppRequest) => void | Promise<void>
}

export default function MyApps({ apps, onOpenApp, onToggleStar, onRemoveApp }: MyAppsProps) {
  const { t, i18n } = useTranslation(['app'])
  const [filter, setFilter] = useQueryStates(myAppsQueryParsers)
  const [removal, setRemoval] = useState<RemoveAppRequest | null>(null)
  const [removalOpen, setRemovalOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const removalSucceededRef = useRef(false)
  const visibleApps = selectApps(apps, filter, i18n.language)
  const emptyTitle = filter.q.trim()
    ? t(($) => $['endUser.noResults'], { ns: 'app' })
    : filter.view === 'starred'
      ? t(($) => $['endUser.emptyStarred'], { ns: 'app' })
      : t(($) => $['endUser.emptyApps'], { ns: 'app' })
  const emptyDescription = filter.q.trim()
    ? t(($) => $['endUser.noResultsDescription'], { ns: 'app' })
    : filter.view === 'starred'
      ? t(($) => $['endUser.emptyStarredDescription'], { ns: 'app' })
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
            onOpenApp={onOpenApp}
            onToggleStar={onToggleStar}
            onRemove={(request) => {
              removalSucceededRef.current = false
              setRemoval(request)
              setRemovalOpen(true)
            }}
          />
        ) : (
          <div className="flex min-h-64 flex-col items-center justify-center gap-2 text-center">
            <span
              className="mb-1 i-ri-apps-2-line size-8 text-text-quaternary"
              aria-hidden="true"
            />
            <h2 className="system-md-semibold text-text-secondary">{emptyTitle}</h2>
            <p className="system-sm-regular text-text-tertiary">{emptyDescription}</p>
            {(filter.q || filter.view === 'starred') && (
              <Button
                variant="secondary"
                onClick={() => {
                  void setFilter({ q: '', view: 'all' })
                }}
              >
                {t(($) => $['endUser.clearFilters'], { ns: 'app' })}
              </Button>
            )}
          </div>
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
