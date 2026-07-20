'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import ExternalAPIPanel from '@/app/components/datasets/external-api/external-api-panel'
import ServiceApi from '@/app/components/datasets/extra-info/service-api'
import { useExternalApiPanel } from '@/context/external-api-panel-context'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { useDatasetApiBaseUrl } from '@/service/knowledge/use-dataset'
import { hasPermission } from '@/utils/permission'
import { KnowledgeSpaceCard } from './components/knowledge-space-card'
import { KnowledgeViewSwitcher } from './components/knowledge-view-switcher'
import {
  KNOWLEDGE_SPACE_GRID_CLASS_NAME,
  NewKnowledgeEmptyState,
  NewKnowledgeLoadingState,
  NewKnowledgePageState,
  UnavailableReason,
} from './components/new-knowledge-list-states'

const PAGE_SIZE = 30

function isUnavailableError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const status = 'status' in error ? error.status : undefined
  if (status === 404 || status === 503) return true

  const data = 'data' in error ? error.data : undefined
  if (!data || typeof data !== 'object') return false
  const dataStatus = 'status' in data ? data.status : undefined
  return dataStatus === 404 || dataStatus === 503
}

function DisabledMetadataFilter({ label, reasonId }: { label: string; reasonId: string }) {
  return (
    <button
      type="button"
      disabled
      aria-describedby={reasonId}
      className="flex h-8 cursor-not-allowed items-center rounded-lg border-[0.5px] border-transparent bg-components-input-bg-disabled px-2 text-components-input-text-filled-disabled"
    >
      <span className="px-1 system-sm-regular">{label}</span>
      <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
    </button>
  )
}

export function NewKnowledgeList({
  view,
  onViewChange,
}: {
  view: 'legacy' | 'new'
  onViewChange: (value: 'legacy' | 'new') => void
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { data: apiBaseInfo } = useDatasetApiBaseUrl()
  const { showExternalApiPanel, setShowExternalApiPanel } = useExternalApiPanel()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canCreate = hasPermission(workspacePermissionKeys, 'dataset.create_and_management')
  const canConnect = hasPermission(workspacePermissionKeys, 'dataset.external.connect')
  const filtersUnavailable = t(($) => $['newKnowledge.filtersUnavailable'])
  const createLabel = tCommon(($) => $['operation.create'])
  const filtersUnavailableId = useId()
  const knowledgeSpacesQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.listKnowledgeSpaces.infiniteOptions({
      input: (pageParam) => ({
        query: {
          limit: PAGE_SIZE,
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      initialPageParam: null as string | null,
    }),
  )
  const knowledgeSpaces = knowledgeSpacesQuery.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <section
      aria-label={t(($) => $['newKnowledge.new'])}
      className="relative flex grow flex-col overflow-y-auto bg-background-body"
    >
      <header className="sticky top-0 z-10 flex flex-col gap-[14px] bg-background-body px-4 pt-4 pb-2 sm:px-8">
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="text-[18px]/[21.6px] font-semibold text-text-primary">
              {t(($) => $.knowledge)}
            </h1>
            <KnowledgeViewSwitcher value={view} onChange={onViewChange} />
          </div>
          <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
            {canConnect && (
              <button
                type="button"
                className="flex h-6 items-center justify-center gap-1 overflow-hidden rounded-md px-1.5 py-1 text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                onClick={() => setShowExternalApiPanel(true)}
              >
                <span
                  aria-hidden
                  className="i-custom-vender-solid-development-api-connection-mod size-3.5 shrink-0"
                />
                <span className="px-0.5 system-xs-medium">{t(($) => $.externalAPIPanelTitle)}</span>
              </button>
            )}
            <ServiceApi apiBaseUrl={apiBaseInfo?.api_base_url ?? ''} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <DisabledMetadataFilter
              label={t(($) => $['newKnowledge.tags'])}
              reasonId={filtersUnavailableId}
            />
            <DisabledMetadataFilter
              label={t(($) => $['newKnowledge.creators'])}
              reasonId={filtersUnavailableId}
            />
            <SearchInput
              disabled
              aria-describedby={filtersUnavailableId}
              className="w-full min-w-0 sm:w-[200px]"
              value=""
              onValueChange={() => undefined}
            />
            <span id={filtersUnavailableId} className="sr-only">
              {filtersUnavailable}
            </span>
            <UnavailableReason label={filtersUnavailable} reason={filtersUnavailable} />
          </div>
          {canCreate && (
            <div className="flex items-center gap-1">
              <Button
                render={<Link href="/datasets/new/create" />}
                variant="primary"
                size="medium"
                className="gap-0.5 px-2 shadow-xs"
              >
                <span aria-hidden className="i-ri-add-line size-4 shrink-0" />
                <span className="pl-1">{createLabel}</span>
              </Button>
            </div>
          )}
        </div>
      </header>
      <div className="px-4 pt-2 pb-8 sm:px-8">
        {knowledgeSpacesQuery.isPending ? (
          <NewKnowledgeLoadingState />
        ) : knowledgeSpacesQuery.error && !knowledgeSpacesQuery.data ? (
          isUnavailableError(knowledgeSpacesQuery.error) ? (
            <NewKnowledgePageState
              title={t(($) => $['newKnowledge.unavailableTitle'])}
              description={t(($) => $['newKnowledge.unavailableDescription'])}
            />
          ) : (
            <NewKnowledgePageState
              title={t(($) => $['newKnowledge.errorTitle'])}
              description={t(($) => $['newKnowledge.errorDescription'])}
              action={
                <Button onClick={() => void knowledgeSpacesQuery.refetch()}>
                  {tCommon(($) => $['operation.retry'])}
                </Button>
              }
            />
          )
        ) : knowledgeSpaces.length === 0 ? (
          <NewKnowledgeEmptyState canConnect={canConnect} canCreate={canCreate} />
        ) : (
          <>
            <ul className={KNOWLEDGE_SPACE_GRID_CLASS_NAME} aria-label={t(($) => $.knowledge)}>
              {knowledgeSpaces.map((knowledgeSpace) => (
                <KnowledgeSpaceCard key={knowledgeSpace.id} knowledgeSpace={knowledgeSpace} />
              ))}
            </ul>
            {knowledgeSpacesQuery.isFetchNextPageError ? (
              <div className="mt-6 flex items-center justify-center gap-3" role="alert">
                <span>{t(($) => $['newKnowledge.errorDescription'])}</span>
                <Button onClick={() => void knowledgeSpacesQuery.fetchNextPage()}>
                  {tCommon(($) => $['operation.retry'])}
                </Button>
              </div>
            ) : knowledgeSpacesQuery.hasNextPage ? (
              <div className="mt-6 flex justify-center">
                <Button
                  loading={knowledgeSpacesQuery.isFetchingNextPage}
                  onClick={() => void knowledgeSpacesQuery.fetchNextPage()}
                >
                  {t(($) => $['newKnowledge.loadMore'])}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
      {showExternalApiPanel && canConnect && (
        <ExternalAPIPanel
          canManageExternalKnowledgeApi={canConnect}
          onClose={() => setShowExternalApiPanel(false)}
        />
      )}
    </section>
  )
}
