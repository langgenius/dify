'use client'

import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { createParser, useQueryState } from 'nuqs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import ExternalAPIPanel from '@/app/components/datasets/external-api/external-api-panel'
import ServiceApi from '@/app/components/datasets/extra-info/service-api'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { knowledgeFsUploadEnabledAtom } from '@/features/system-features/state'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { useDatasetApiBaseUrl } from '@/service/knowledge/use-dataset'
import { hasPermission } from '@/utils/permission'
import {
  CREATOR_FILTER_MAX_ID_LENGTH,
  CREATOR_FILTER_MAX_SELECTION,
  CreatorFilter,
} from './components/creator-filter'
import { KnowledgeSpaceCard } from './components/knowledge-space-card'
import { KnowledgeViewSwitcher } from './components/knowledge-view-switcher'
import {
  KNOWLEDGE_SPACE_GRID_CLASS_NAME,
  NewKnowledgeEmptyState,
  NewKnowledgeLoadingState,
  NewKnowledgePageState,
} from './components/new-knowledge-list-states'

const PAGE_SIZE = 30

function normalizeCreatorIds(creatorIds: string[]) {
  return [...new Set(creatorIds)]
    .filter((creatorId) => creatorId.length > 0 && creatorId.length <= CREATOR_FILTER_MAX_ID_LENGTH)
    .slice(0, CREATOR_FILTER_MAX_SELECTION)
}

const creatorIdsParser = createParser<string[]>({
  eq: (left, right) =>
    left.length === right.length && left.every((creatorId, index) => creatorId === right[index]),
  parse: (query) => normalizeCreatorIds(query.split(';')),
  serialize: (creatorIds) => normalizeCreatorIds(creatorIds).join(';'),
})
  .withDefault([])
  .withOptions({ history: 'push' })

function isUnavailableError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const status = 'status' in error ? error.status : undefined
  if (status === 404 || status === 503) return true

  const data = 'data' in error ? error.data : undefined
  if (!data || typeof data !== 'object') return false
  const dataStatus = 'status' in data ? data.status : undefined
  return dataStatus === 404 || dataStatus === 503
}

function MetadataFilter({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      variant="tertiary"
      className="gap-0 border-0 bg-components-input-bg-normal px-2 font-normal text-text-tertiary shadow-none hover:bg-components-input-bg-hover"
      onClick={onClick}
    >
      <span className="px-1 system-sm-regular">{label}</span>
      <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
    </Button>
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
  const [showExternalApiPanel, setShowExternalApiPanel] = useState(false)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const uploadAvailable = useAtomValue(knowledgeFsUploadEnabledAtom)
  const canCreate = hasPermission(workspacePermissionKeys, 'dataset.create_and_management')
  const canConnect = hasPermission(workspacePermissionKeys, 'dataset.external.connect')
  const filtersUnavailable = t(($) => $['newKnowledge.filtersUnavailable'])
  const showFilterBoundary = () => toast.info(filtersUnavailable)
  const createLabel = tCommon(($) => $['operation.create'])
  const [searchValue, setSearchValue] = useState('')
  const [creatorIds, setCreatorIds] = useQueryState('creator_ids', creatorIdsParser)
  const knowledgeSpacesQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.spaces.get.infiniteOptions({
      input: (pageParam) => ({
        query: {
          limit: PAGE_SIZE,
          page: pageParam,
          ...(creatorIds.length > 0 ? { creator_ids: creatorIds } : {}),
        },
      }),
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
      initialPageParam: 1,
    }),
  )
  const knowledgeSpaces = knowledgeSpacesQuery.data?.pages.flatMap((page) => page.data) ?? []
  const normalizedSearchValue = searchValue.trim().toLocaleLowerCase()
  const visibleKnowledgeSpaces = normalizedSearchValue
    ? knowledgeSpaces.filter(
        (knowledgeSpace) =>
          knowledgeSpace.technical_summary?.name
            .toLocaleLowerCase()
            .includes(normalizedSearchValue) ||
          knowledgeSpace.technical_summary?.description
            ?.toLocaleLowerCase()
            .includes(normalizedSearchValue),
      )
    : knowledgeSpaces

  return (
    <section
      aria-label={t(($) => $['newKnowledge.new'])}
      className="relative flex grow flex-col overflow-y-auto bg-background-body"
    >
      <header className="sticky top-0 z-10 flex flex-col gap-3.5 bg-background-body px-4 pt-4 pb-2 sm:px-8">
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="text-[18px]/[21.6px] font-semibold text-text-primary">
              {t(($) => $.knowledge)}
            </h1>
            <KnowledgeViewSwitcher value={view} onChange={onViewChange} />
          </div>
          <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
            {canConnect && (
              <Button
                variant="ghost"
                size="small"
                className="overflow-hidden text-text-tertiary"
                onClick={() => setShowExternalApiPanel(true)}
              >
                <span
                  aria-hidden
                  className="i-custom-vender-solid-development-api-connection-mod size-3.5 shrink-0"
                />
                <span className="system-xs-medium">{t(($) => $.externalAPIPanelTitle)}</span>
              </Button>
            )}
            <ServiceApi apiBaseUrl={apiBaseInfo?.api_base_url ?? ''} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <MetadataFilter label={t(($) => $['newKnowledge.tags'])} onClick={showFilterBoundary} />
            <CreatorFilter
              value={creatorIds}
              onChange={(nextCreatorIds) => void setCreatorIds(nextCreatorIds)}
            />
            <SearchInput
              className="w-full min-w-0 sm:w-50"
              value={searchValue}
              onValueChange={setSearchValue}
            />
          </div>
          {canCreate && (
            <div className="flex items-center gap-1">
              <Button
                render={<Link href="/datasets/new/create" />}
                variant="primary"
                size="medium"
                className="w-24 gap-0.5 overflow-hidden border-[0.5px]! border-components-button-primary-border-hover! bg-components-button-primary-bg-hover! p-2! shadow-xs"
              >
                <span aria-hidden className="i-ri-add-line size-4 shrink-0" />
                <span className="pl-1">{createLabel}</span>
              </Button>
            </div>
          )}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        {knowledgeSpacesQuery.isPending ? (
          <div className="px-4 pt-2 pb-8 sm:px-8">
            <NewKnowledgeLoadingState />
          </div>
        ) : knowledgeSpacesQuery.error && !knowledgeSpacesQuery.data ? (
          <div className="px-4 pt-2 pb-8 sm:px-8">
            {isUnavailableError(knowledgeSpacesQuery.error) ? (
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
            )}
          </div>
        ) : normalizedSearchValue && visibleKnowledgeSpaces.length === 0 ? (
          <div className="px-4 pt-2 pb-8 sm:px-8">
            <NewKnowledgePageState
              title={tCommon(($) => $['operation.noSearchResults'], {
                content: t(($) => $.knowledge),
              })}
              description={searchValue.trim()}
              action={
                <Button onClick={() => setSearchValue('')}>
                  {tCommon(($) => $['operation.clear'])}
                </Button>
              }
            />
          </div>
        ) : knowledgeSpaces.length === 0 && creatorIds.length === 0 ? (
          <NewKnowledgeEmptyState
            canConnect={canConnect}
            canCreate={canCreate}
            uploadAvailable={uploadAvailable}
          />
        ) : knowledgeSpaces.length === 0 ? (
          <div className="flex min-h-105 items-center justify-center px-6 text-center text-text-tertiary">
            {tCommon(($) => $['operation.noSearchResults'], {
              content: t(($) => $['newKnowledge.creators']),
            })}
          </div>
        ) : (
          <div className="px-4 pt-2 pb-8 sm:px-8">
            <ul className={KNOWLEDGE_SPACE_GRID_CLASS_NAME} aria-label={t(($) => $.knowledge)}>
              {visibleKnowledgeSpaces.map((knowledgeSpace) => (
                <KnowledgeSpaceCard
                  key={knowledgeSpace.control_space_id}
                  knowledgeSpace={knowledgeSpace}
                />
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
          </div>
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
