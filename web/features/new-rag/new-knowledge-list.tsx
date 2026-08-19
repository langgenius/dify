'use client'

import type { KnowledgeUpgrade } from './upgrade/knowledge-upgrade-context-value'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useInfiniteQuery, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useAtomValue } from 'jotai'
import { createParser, parseAsString, useQueryState } from 'nuqs'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { CreatorFilter } from '@/app/components/datasets/creator-filter'
import { creatorIdsParser } from '@/app/components/datasets/creator-filter-query'
import ExternalAPIPanel from '@/app/components/datasets/external-api/external-api-panel'
import { ServiceApi } from '@/app/components/datasets/extra-info/service-api'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { knowledgeFsUploadEnabledAtom } from '@/features/system-features/state'
import { TagFilter } from '@/features/tag-management/components/tag-filter'
import { TagManagementModal } from '@/features/tag-management/components/tag-management-modal'
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
} from './components/new-knowledge-list-states'
import { KnowledgeUpgradeCard } from './upgrade/knowledge-upgrade-card'
import { useKnowledgeUpgrade } from './upgrade/knowledge-upgrade-context-value'
import { matchesKnowledgeUpgradeFilters } from './upgrade/knowledge-upgrade-filters'

const PAGE_SIZE = 30
const UPGRADE_DATASET_BATCH_SIZE = 50
const UPGRADE_FAILED_JOB_LIMIT = 100
const UPGRADE_HIGHLIGHT_DURATION = 5_000
const TAG_FILTER_MAX_ID_LENGTH = 255
const TAG_FILTER_MAX_SELECTION = 100
const searchParser = parseAsString.withDefault('').withOptions({
  history: 'replace',
})

function normalizeTagIds(tagIds: string[]) {
  return [...new Set(tagIds)]
    .filter((tagId) => tagId.length > 0 && tagId.length <= TAG_FILTER_MAX_ID_LENGTH)
    .slice(0, TAG_FILTER_MAX_SELECTION)
}

function batchUpgradeDatasetIds(datasetIds: string[]) {
  return Array.from(
    { length: Math.ceil(datasetIds.length / UPGRADE_DATASET_BATCH_SIZE) },
    (_, index) =>
      datasetIds.slice(
        index * UPGRADE_DATASET_BATCH_SIZE,
        (index + 1) * UPGRADE_DATASET_BATCH_SIZE,
      ),
  )
}

function selectUpgradeRecoveryJobs(jobs: KnowledgeUpgrade['job'][]) {
  let failedJobCount = 0
  return jobs.filter((job) => {
    if (job.status !== 'failed') return true

    failedJobCount += 1
    return failedJobCount <= UPGRADE_FAILED_JOB_LIMIT
  })
}

const tagIdsParser = createParser<string[]>({
  eq: (left, right) =>
    left.length === right.length && left.every((tagId, index) => tagId === right[index]),
  parse: (query) => normalizeTagIds(query.split(';')),
  serialize: (tagIds) => normalizeTagIds(tagIds).join(';'),
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

export function NewKnowledgeList({
  view,
  onViewChange,
}: {
  view: 'legacy' | 'new'
  onViewChange: (value: 'legacy' | 'new') => void
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const { data: apiBaseInfo } = useDatasetApiBaseUrl()
  const [showExternalApiPanel, setShowExternalApiPanel] = useState(false)
  const [showTagManagementModal, setShowTagManagementModal] = useState(false)
  const [highlightedControlSpaceId, setHighlightedControlSpaceId] = useState<string>()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const uploadAvailable = useAtomValue(knowledgeFsUploadEnabledAtom)
  const { dismissUpgrade, settleUpgrade, upgrades } = useKnowledgeUpgrade()
  const canCreate = hasPermission(workspacePermissionKeys, 'dataset.create_and_management')
  const canConnect = hasPermission(workspacePermissionKeys, 'dataset.external.connect')
  const createLabel = tCommon(($) => $['operation.create'])
  const [searchValue, setSearchValue] = useQueryState('query', searchParser)
  const debouncedSearchValue = useDebounce(searchValue.trim(), { wait: 300 })
  const [creatorIds, setCreatorIds] = useQueryState('creator_ids', creatorIdsParser)
  const [tagIds, setTagIds] = useQueryState('tag_ids', tagIdsParser)
  const knowledgeSpacesQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.spaces.get.infiniteOptions({
      input: (pageParam) => ({
        query: {
          limit: PAGE_SIZE,
          page: pageParam,
          ...(creatorIds.length > 0 ? { creator_ids: creatorIds } : {}),
          ...(tagIds.length > 0 ? { tag_ids: tagIds } : {}),
          ...(debouncedSearchValue ? { query: debouncedSearchValue } : {}),
        },
      }),
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
      initialPageParam: 1,
    }),
  )
  const upgradeJobsQuery = useQuery(consoleQuery.datasets.knowledgeFsUpgradeJobs.get.queryOptions())
  const upgradeRecoveryJobs = selectUpgradeRecoveryJobs(upgradeJobsQuery.data?.data ?? [])
  const upgradeDatasetIds = [...new Set(upgradeRecoveryJobs.map((job) => job.old_dataset_id))]
  const upgradeDatasetIdBatches = batchUpgradeDatasetIds(upgradeDatasetIds)
  const upgradeDatasetsQueries = useQueries({
    queries: upgradeDatasetIdBatches.map((datasetIds) =>
      consoleQuery.datasets.get.queryOptions({ input: { query: { ids: datasetIds } } }),
    ),
  })
  const knowledgeSpaces = knowledgeSpacesQuery.data?.pages.flatMap((page) => page.data) ?? []
  const upgradeDatasetsById = new Map(
    upgradeDatasetsQueries.flatMap(
      (query) => query.data?.data.map((dataset) => [dataset.id, dataset] as const) ?? [],
    ),
  )
  const upgradeRecoveryPending =
    upgradeJobsQuery.isPending || upgradeDatasetsQueries.some((query) => query.isPending)
  const upgradeRecoveryError =
    upgradeJobsQuery.error ?? upgradeDatasetsQueries.find((query) => query.error)?.error
  const activeUpgradeDatasetIds = new Set(
    upgradeRecoveryJobs.flatMap((job) =>
      job.status === 'queued' || job.status === 'running' ? [job.old_dataset_id] : [],
    ),
  )
  const recoveredUpgrades = upgradeRecoveryJobs.flatMap((job) => {
    const dataset = upgradeDatasetsById.get(job.old_dataset_id)
    const discovery = dataset?.knowledge_fs_upgrade
    return dataset
      ? [
          {
            canRetry:
              job.status === 'failed' &&
              !activeUpgradeDatasetIds.has(job.old_dataset_id) &&
              Boolean(discovery?.can_retry || discovery?.can_upgrade),
            dataset,
            job,
          },
        ]
      : []
  })
  const upgradesByJobId = new Map<string, KnowledgeUpgrade>(
    recoveredUpgrades.map((upgrade) => [upgrade.job.id, upgrade]),
  )
  upgrades.forEach((upgrade) => {
    const recoveredUpgrade = upgradesByJobId.get(upgrade.job.id)
    if (!recoveredUpgrade) {
      upgradesByJobId.set(upgrade.job.id, upgrade)
      return
    }
    if (upgrade.job.status === 'succeeded') {
      upgradesByJobId.set(upgrade.job.id, {
        ...recoveredUpgrade,
        job: upgrade.job,
      })
    }
  })
  const visibleUpgrades = [...upgradesByJobId.values()]
  const pendingUpgradeCards = visibleUpgrades.filter(
    (upgrade) =>
      matchesKnowledgeUpgradeFilters(upgrade, {
        creatorIds,
        query: debouncedSearchValue,
        tagIds,
      }) &&
      (upgrade.job.status !== 'succeeded' ||
        !upgrade.job.new_control_space_id ||
        !knowledgeSpaces.some(
          (knowledgeSpace) => knowledgeSpace.control_space_id === upgrade.job.new_control_space_id,
        )),
  )
  const pendingUpgradeControlSpaceIds = new Set(
    pendingUpgradeCards.flatMap((upgrade) =>
      upgrade.job.new_control_space_id ? [upgrade.job.new_control_space_id] : [],
    ),
  )
  const visibleKnowledgeSpaces = knowledgeSpaces.filter(
    (knowledgeSpace) => !pendingUpgradeControlSpaceIds.has(knowledgeSpace.control_space_id),
  )
  const hasVisibleKnowledge = visibleKnowledgeSpaces.length > 0 || pendingUpgradeCards.length > 0

  const refetchUpgradeRecovery = () => {
    void upgradeJobsQuery.refetch()
    upgradeDatasetsQueries.forEach((query) => void query.refetch())
  }

  useEffect(() => {
    const visibleControlSpaceIds = new Set(
      knowledgeSpacesQuery.data?.pages.flatMap((page) =>
        page.data.map((knowledgeSpace) => knowledgeSpace.control_space_id),
      ) ?? [],
    )
    upgrades.forEach((upgrade) => {
      if (
        upgrade.job.status === 'succeeded' &&
        upgrade.job.new_control_space_id &&
        visibleControlSpaceIds.has(upgrade.job.new_control_space_id) &&
        !upgradeJobsQuery.data?.data.some((job) => job.id === upgrade.job.id)
      ) {
        dismissUpgrade(upgrade.job.id)
      }
    })
  }, [dismissUpgrade, knowledgeSpacesQuery.data, upgradeJobsQuery.data, upgrades])

  useEffect(() => {
    if (!highlightedControlSpaceId) return

    const timeoutId = window.setTimeout(
      () => setHighlightedControlSpaceId(undefined),
      UPGRADE_HIGHLIGHT_DURATION,
    )
    return () => window.clearTimeout(timeoutId)
  }, [highlightedControlSpaceId])

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
            <TagFilter
              type="knowledge"
              value={tagIds}
              onChange={(nextTagIds) => void setTagIds(nextTagIds)}
              onOpenTagManagement={() => setShowTagManagementModal(true)}
              showLeadingIcon={false}
              triggerClassName="min-w-0"
            />
            <CreatorFilter
              value={creatorIds}
              onChange={(nextCreatorIds) => void setCreatorIds(nextCreatorIds)}
            />
            <SearchInput
              className="w-full min-w-0 sm:w-50"
              value={searchValue}
              onValueChange={(value) => void setSearchValue(value || null)}
            />
          </div>
          {canCreate && (
            <div className="flex items-center gap-1">
              <Link
                href="/datasets/new/create"
                className={cn(
                  buttonVariants({ variant: 'primary', size: 'medium' }),
                  'w-24 gap-0.5 overflow-hidden p-2!',
                )}
              >
                <span aria-hidden className="i-ri-add-line size-4 shrink-0" />
                <span className="pl-1">{createLabel}</span>
              </Link>
            </div>
          )}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        {knowledgeSpacesQuery.isPending || (upgradeRecoveryPending && !hasVisibleKnowledge) ? (
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
        ) : upgradeRecoveryError && !hasVisibleKnowledge ? (
          <div className="px-4 pt-2 pb-8 sm:px-8">
            <NewKnowledgePageState
              title={t(($) => $['newKnowledge.errorTitle'])}
              description={t(($) => $['newKnowledge.errorDescription'])}
              action={
                <Button onClick={refetchUpgradeRecovery}>
                  {tCommon(($) => $['operation.retry'])}
                </Button>
              }
            />
          </div>
        ) : debouncedSearchValue && !hasVisibleKnowledge ? (
          <div className="px-4 pt-2 pb-8 sm:px-8">
            <NewKnowledgePageState
              title={tCommon(($) => $['operation.noSearchResults'], {
                content: t(($) => $.knowledge),
              })}
              description={searchValue.trim()}
              action={
                <Button onClick={() => void setSearchValue(null)}>
                  {tCommon(($) => $['operation.clear'])}
                </Button>
              }
            />
          </div>
        ) : !hasVisibleKnowledge && creatorIds.length === 0 && tagIds.length === 0 ? (
          <NewKnowledgeEmptyState
            canConnect={canConnect}
            canCreate={canCreate}
            uploadAvailable={uploadAvailable}
          />
        ) : !hasVisibleKnowledge ? (
          <div className="flex min-h-105 items-center justify-center px-6 text-center text-text-tertiary">
            {tCommon(($) => $['operation.noSearchResults'], {
              content: t(($) => $.knowledge),
            })}
          </div>
        ) : (
          <div className="px-4 pt-2 pb-8 sm:px-8">
            {upgradeRecoveryError && (
              <div className="mb-4 flex items-center justify-center gap-3" role="alert">
                <span>{t(($) => $['newKnowledge.errorDescription'])}</span>
                <Button onClick={refetchUpgradeRecovery}>
                  {tCommon(($) => $['operation.retry'])}
                </Button>
              </div>
            )}
            <ul className={KNOWLEDGE_SPACE_GRID_CLASS_NAME} aria-label={t(($) => $.knowledge)}>
              {pendingUpgradeCards.map((upgrade) => (
                <KnowledgeUpgradeCard
                  key={upgrade.job.id}
                  upgrade={upgrade}
                  highlighted={highlightedControlSpaceId === upgrade.job.new_control_space_id}
                  onSucceeded={setHighlightedControlSpaceId}
                  onSettled={settleUpgrade}
                />
              ))}
              {visibleKnowledgeSpaces.map((knowledgeSpace) => (
                <KnowledgeSpaceCard
                  key={knowledgeSpace.control_space_id}
                  knowledgeSpace={knowledgeSpace}
                  highlighted={highlightedControlSpaceId === knowledgeSpace.control_space_id}
                  onOpenTagManagement={() => setShowTagManagementModal(true)}
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
      <TagManagementModal
        type="knowledge"
        show={showTagManagementModal}
        onClose={() => setShowTagManagementModal(false)}
        onTagsChange={() => {
          void queryClient.invalidateQueries({
            queryKey: consoleQuery.knowledgeFs.spaces.get.key(),
          })
        }}
      />
      {showExternalApiPanel && canConnect && (
        <ExternalAPIPanel
          canManageExternalKnowledgeApi={canConnect}
          onClose={() => setShowExternalApiPanel(false)}
        />
      )}
    </section>
  )
}
